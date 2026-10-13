"""WePay.ai API: conversational expense parsing and PayPal sandbox checkout."""
from __future__ import annotations

import os
import json
import base64
import binascii
import logging
import math
import re
import time
import uuid
import asyncio
import unicodedata
from datetime import date, timedelta
from contextlib import asynccontextmanager
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com"
FX_API_BASE = "https://api.frankfurter.dev"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com"
GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe"
GEMINI_EXPENSE_MODEL = "gemini-3.8-flash"
PAYPAL_CHECKOUT_CURRENCIES = {"AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "NOK", "NZD", "PHP", "PLN", "RUB", "SEK", "SGD", "THB", "TWD", "USD", "CHF"}
ZERO_DECIMAL_CURRENCIES = {"BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF", "HUF", "TWD"}
THREE_DECIMAL_CURRENCIES = {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}
FOUR_DECIMAL_CURRENCIES = {"CLF", "UYW"}
NUMBER_DIGIT_TRANSLATION = str.maketrans("०१२३४५६७८९", "0123456789")
AMOUNT_UNIT_MULTIPLIERS = {
    "thousand": Decimal("1000"), "thousands": Decimal("1000"),
    "hazar": Decimal("1000"), "hazaar": Decimal("1000"), "hajaar": Decimal("1000"),
    "हजार": Decimal("1000"), "हज़ार": Decimal("1000"), "हज़ार": Decimal("1000"),
    "lakh": Decimal("100000"), "lakhs": Decimal("100000"), "lac": Decimal("100000"), "lacs": Decimal("100000"), "लाख": Decimal("100000"), "লাখ": Decimal("100000"), "લાખ": Decimal("100000"), "ਲੱਖ": Decimal("100000"), "லட்சம்": Decimal("100000"), "இலட்சம்": Decimal("100000"), "లక్ష": Decimal("100000"), "లక్షలు": Decimal("100000"), "ಲಕ್ಷ": Decimal("100000"), "ലക്ഷം": Decimal("100000"),
    "crore": Decimal("10000000"), "crores": Decimal("10000000"), "करोड़": Decimal("10000000"), "करोड": Decimal("10000000"), "करोड़": Decimal("10000000"), "কোটি": Decimal("10000000"), "કરોડ": Decimal("10000000"), "ਕਰੋੜ": Decimal("10000000"), "கோடி": Decimal("10000000"), "కోటి": Decimal("10000000"), "ಕೋಟಿ": Decimal("10000000"), "കോടി": Decimal("10000000"),
    "million": Decimal("1000000"), "millions": Decimal("1000000"),
    "billion": Decimal("1000000000"), "billions": Decimal("1000000000"),
}
MAX_AUDIO_BYTES = 15 * 1024 * 1024
SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/webm": ("voice.webm", "audio/webm"),
    "audio/ogg": ("voice.ogg", "audio/ogg"),
    "audio/mp4": ("voice.mp4", "audio/mp4"),
    "audio/m4a": ("voice.m4a", "audio/m4a"),
    "audio/mpeg": ("voice.mp3", "audio/mpeg"),
    "audio/mp3": ("voice.mp3", "audio/mpeg"),
    "audio/wav": ("voice.wav", "audio/wav"),
    "audio/x-wav": ("voice.wav", "audio/wav"),
}
FX_CACHE: dict[str, tuple[float, dict]] = {}
FX_CURRENCIES_CACHE: tuple[float, list[dict[str, str]]] | None = None
FX_VOLATILITY_CACHE: dict[str, tuple[float, dict]] = {}
FX_VOLATILITY_THRESHOLD_PERCENT = 20.0
PAYPAL_RUNTIME_CREDENTIALS: tuple[str, str] | None = None
logger = logging.getLogger("wepay.gemini_parser")
load_dotenv(Path(__file__).with_name(".env"), override=False)


@asynccontextmanager
async def lifespan(application: FastAPI):
    limits = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30.0)
    timeout = httpx.Timeout(60.0, connect=5.0, write=30.0, pool=5.0)
    async with httpx.AsyncClient(base_url=GEMINI_API_BASE, timeout=timeout, limits=limits) as client:
        application.state.gemini_client = client
        yield


class VoiceInputPayload(BaseModel):
    text: str = Field(min_length=3, max_length=1000, description="Spoken or typed expense description")

    @field_validator("text")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Expense description cannot be blank")
        return value


VoiceInputRequest = VoiceInputPayload


class SettlePayload(BaseModel):
    payer: str = Field(min_length=1, max_length=100)
    amount: Decimal = Field(gt=Decimal("0"), max_digits=16, decimal_places=4)
    currency: str = Field(min_length=3, max_length=3)
    shared_with: list[str] = Field(default_factory=list, max_length=30)
    description: str = Field(default="Shared expense", min_length=1, max_length=160)
    original_amount: Decimal | None = None
    original_currency: str | None = None
    exchange_rate: Decimal | None = None
    exchange_rate_date: str | None = None
    high_risk_acknowledged: bool = False
    hedging_override_acknowledged: bool = False

    @field_validator("payer", "shared_with", mode="before")
    @classmethod
    def trim_names(cls, value):
        if isinstance(value, list):
            return [item.strip() for item in value if isinstance(item, str) and item.strip()]
        return value.strip() if isinstance(value, str) else value

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, value: str) -> str:
        value = value.upper()
        if not re.fullmatch(r"[A-Z]{3}", value):
            raise ValueError("Currency must be a three-letter ISO code")
        return value

    @field_validator("shared_with")
    @classmethod
    def unique_people(cls, value: list[str]) -> list[str]:
        normalized = [name for name in value if name]
        if len({name.casefold() for name in normalized}) != len(normalized):
            raise ValueError("Each participant may only appear once")
        return normalized

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str) -> str:
        return value.strip()


ExpensePayload = SettlePayload


class UserSettingsPayload(BaseModel):
    biometric_voice_match: bool = True
    hedging_frequency: Literal["high", "balanced"] = "high"
    default_currency: str = Field(default="USD", min_length=3, max_length=3, pattern=r"^[A-Za-z]{3}$")
    notification_channels: dict[str, bool] = Field(default_factory=lambda: {"in_app": True, "audio": False, "webhook": False})
    webhook_target: str = Field(default="", max_length=2048)

    @field_validator("default_currency")
    @classmethod
    def uppercase_default_currency(cls, value: str) -> str:
        return value.upper()


class Liability(BaseModel):
    person: str
    amount: Decimal
    currency: str


class ParseVoiceResponse(ExpensePayload):
    liabilities: list[Liability]
    fraud_risk: Literal["LOW", "HIGH"] = "LOW"
    volatility_index: float | None = None
    hedging_advice: str | None = None
    hedging_hold_recommended: bool = False


class LiveVoiceResponse(ParseVoiceResponse):
    transcript: str
    orderId: str | None = None
    checkoutUrl: str | None = None
    checkoutAmount: str | None = None
    checkoutCurrency: str | None = None
    parserFallback: bool = False


class AIExpenseExtraction(BaseModel):
    payer: str = Field(min_length=1, max_length=100)
    amount: Decimal = Field(gt=Decimal("0"), max_digits=16, decimal_places=4)
    currency: str = Field(min_length=3, max_length=3)
    shared_with: list[str] = Field(max_length=30)
    description: str = Field(min_length=1, max_length=160)

    @field_validator("payer", "shared_with", mode="before")
    @classmethod
    def trim_extracted_names(cls, value):
        if isinstance(value, list):
            return [name.strip() for name in value if isinstance(name, str) and name.strip()]
        return value.strip() if isinstance(value, str) else value

    @field_validator("currency")
    @classmethod
    def normalize_extracted_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", normalized):
            raise ValueError("Currency must be a three-letter ISO code")
        return normalized

    @field_validator("shared_with")
    @classmethod
    def unique_extracted_people(cls, value: list[str]) -> list[str]:
        if len({name.casefold() for name in value}) != len(value):
            raise ValueError("Each participant may only appear once")
        return value


def normalize_gemini_expense(raw_output: str) -> tuple[dict, bool]:
    """Extract and sanitize Gemini JSON; flag every fallback so checkout is withheld."""
    fallback = {
        "payer": "Family Member",
        "amount": 20.00,
        "currency": "USD",
        "shared_with": ["Rahul", "Amit"],
        "description": "WePay Unified Ledger Entry",
    }
    fallback_used = False
    try:
        if not isinstance(raw_output, str) or not raw_output.strip():
            raise ValueError("Gemini returned empty text")
        cleaned = re.sub(r"```\s*(?:json)?\s*|```", "", raw_output, flags=re.IGNORECASE).strip()
        opening_brace = re.search(r"\{", cleaned)
        if opening_brace is None:
            raise ValueError("Gemini output did not contain a JSON object")
        _, end_index = json.JSONDecoder().raw_decode(cleaned, opening_brace.start())
        json_substring = cleaned[opening_brace.start():end_index]
        parsed = json.loads(json_substring)
        if not isinstance(parsed, dict):
            raise TypeError("Gemini output JSON was not an object")
        required_keys = {"payer", "amount", "currency", "shared_with", "description"}
        fallback_used = not required_keys.issubset(parsed)

        payer_value = parsed.get("payer")
        if isinstance(payer_value, str) and payer_value.strip():
            payer = payer_value.strip()[:100]
        else:
            payer = fallback["payer"]
            fallback_used = True

        currency = str(parsed.get("currency", fallback["currency"])).strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", currency):
            currency = fallback["currency"]
            fallback_used = True

        try:
            raw_amount = parsed.get("amount", fallback["amount"])
            if isinstance(raw_amount, bool):
                raise TypeError("Boolean is not a valid amount")
            amount_value = Decimal(str(raw_amount))
            if not amount_value.is_finite() or amount_value <= 0 or amount_value > Decimal("999999999999.9999"):
                raise ValueError("Gemini amount was outside the supported range")
            amount = amount_value.quantize(currency_quantum(currency), rounding=ROUND_HALF_UP)
        except (TypeError, ValueError, OverflowError, ArithmeticError):
            amount = fallback["amount"]
            fallback_used = True

        shared_value = parsed.get("shared_with", fallback["shared_with"])
        if isinstance(shared_value, (list, tuple, set)):
            shared_with = list(shared_value)
            if any(not isinstance(name, str) or not name.strip() for name in shared_with):
                shared_with = list(fallback["shared_with"])
                fallback_used = True
            else:
                shared_with = [name.strip()[:100] for name in shared_with]
        else:
            shared_with = list(fallback["shared_with"])
            fallback_used = True
        shared_with = [name for index, name in enumerate(shared_with) if name.casefold() != payer.casefold() and name.casefold() not in {prior.casefold() for prior in shared_with[:index]}][:30]

        description_value = parsed.get("description")
        if isinstance(description_value, str) and description_value.strip():
            description = description_value.strip()[:160]
        else:
            description = fallback["description"]
            fallback_used = True

        return {
            "payer": payer,
            "amount": amount,
            "currency": currency,
            "shared_with": shared_with,
            "description": description,
        }, fallback_used
    except Exception as exc:
        logger.warning("Gemini expense parsing failed; fallback data requires user review (%s)", type(exc).__name__)
        return dict(fallback), True


class CreateOrderResponse(BaseModel):
    orderId: str
    approvalUrl: str
    amount: str
    currency: str
    sourceAmount: str
    sourceCurrency: str
    exchangeRate: str | None = None
    exchangeRateDate: str | None = None
    liabilities: list[Liability]
    requestId: str
    fraud_risk: Literal["LOW", "HIGH"] = "LOW"
    volatility_index: float | None = None
    hedging_advice: str | None = None
    hedging_hold_recommended: bool = False


class PayPalCredentialInput(BaseModel):
    client_id: str = Field(min_length=1, max_length=512)
    client_secret: str = Field(min_length=1, max_length=512)

    @field_validator("client_id", "client_secret")
    @classmethod
    def validate_credential(cls, value: str) -> str:
        value = value.strip()
        if not value or "\r" in value or "\n" in value or "\x00" in value:
            raise ValueError("Enter a valid PayPal sandbox credential")
        return value


class PayPalCaptureRequest(BaseModel):
    order_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Z0-9-]+$")



FRONTEND_ORIGINS = {
    "https://we-pay-iota.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
}

app = FastAPI(
    title="WePay.ai API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(FRONTEND_ORIGINS),
    allow_origin_regex=r"https://we-pay-[a-zA-Z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=[
        "GET", "POST", "PUT", "PATCH",
        "DELETE", "OPTIONS",
    ],
    allow_headers=["Content-Type", "Authorization"],
)



class LedgerConnectionManager:
    """Own active browser sockets and publish normalized ledger events."""

    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()
        self.ledger: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    async def connect(self, socket: WebSocket) -> None:
        await socket.accept()
        async with self._lock:
            self.connections.add(socket)
            snapshot = list(self.ledger.values())
        await socket.send_json({"type": "ledger.snapshot", "ledger": snapshot})

    async def disconnect(self, socket: WebSocket) -> None:
        async with self._lock:
            self.connections.discard(socket)

    async def publish(self, event: dict) -> None:
        async with self._lock:
            sockets = list(self.connections)

        async def send(socket: WebSocket) -> WebSocket | None:
            try:
                await socket.send_json(event)
                return None
            except Exception:
                return socket

        stale = [socket for socket in await asyncio.gather(*(send(connection) for connection in sockets)) if socket is not None]
        if stale:
            async with self._lock:
                for socket in stale:
                    self.connections.discard(socket)

    async def add_expense(self, expense: ExpensePayload, status: str = "Pending", event_id: str | None = None) -> dict:
        record_id = event_id or str(uuid.uuid4())
        row = {
            "id": record_id,
            "description": expense.description,
            "payer": expense.payer,
            "amount": float(expense.amount),
            "currency": expense.currency,
            "sharedWith": list(expense.shared_with),
            "status": status,
            "date": "Just now",
            "initials": expense.payer[:2].upper(),
            "color": "mint",
            "settledMembers": [],
        }
        async with self._lock:
            self.ledger[record_id] = row
        return row


ledger_manager = LedgerConnectionManager()


def paypal_return_urls(request: Request) -> tuple[str | None, str | None]:
    origin = request.headers.get("origin", "").rstrip("/")
    if origin not in FRONTEND_ORIGINS:
        return None, None
    return f"{origin}/?paypal=return", f"{origin}/?paypal=cancel"


def paypal_checkout_currency() -> str:
    currency = os.getenv("PAYPAL_CHECKOUT_CURRENCY", "USD").strip().upper()
    if currency not in PAYPAL_CHECKOUT_CURRENCIES:
        raise HTTPException(status_code=503, detail="PAYPAL_CHECKOUT_CURRENCY must be a PayPal-supported currency such as USD, EUR, or GBP.")
    return currency


def currency_fraction_digits(currency: str) -> int:
    code = currency.upper()
    if code in ZERO_DECIMAL_CURRENCIES:
        return 0
    if code in THREE_DECIMAL_CURRENCIES:
        return 3
    if code in FOUR_DECIMAL_CURRENCIES:
        return 4
    return 2


def currency_quantum(currency: str) -> Decimal:
    return Decimal(1).scaleb(-currency_fraction_digits(currency))


def quantize_currency(value: Decimal, currency: str) -> Decimal:
    return value.quantize(currency_quantum(currency), rounding=ROUND_HALF_UP)


def format_currency_amount(value: Decimal, currency: str) -> str:
    digits = currency_fraction_digits(currency)
    rounded = quantize_currency(value, currency)
    return f"{rounded:.{digits}f}"


def calculate_liabilities(expense: ExpensePayload) -> list[Liability]:
    """Split integer minor units deterministically; remainders go to early participants."""
    participants = [expense.payer, *expense.shared_with]
    fraction_digits = currency_fraction_digits(expense.currency)
    unit_factor = 10 ** fraction_digits
    total_units = int((expense.amount * unit_factor).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    base_units, remainder = divmod(total_units, len(participants))
    return [
        Liability(person=person, amount=Decimal(base_units + (index < remainder)).scaleb(-fraction_digits), currency=expense.currency)
        for index, person in enumerate(participants)
    ]


def parse_amount(raw: str, currency: str = "USD") -> Decimal:
    cleaned = raw.replace(",", "").strip()
    try:
        value = quantize_currency(Decimal(cleaned), currency)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="I couldn't identify a valid amount. Try a number such as 3000 or 120.50.") from exc
    if value <= 0:
        raise HTTPException(status_code=422, detail="The expense amount must be greater than zero.")
    return value


def parse_spoken_amount(number: str, unit: str | None = None, currency: str = "USD") -> Decimal:
    normalized_number = "".join(str(unicodedata.decimal(character)) if character.isdecimal() else character for character in number).replace(",", "").strip()
    try:
        amount = Decimal(normalized_number)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="I couldn't identify a valid spoken amount.") from exc
    if unit:
        amount *= AMOUNT_UNIT_MULTIPLIERS[unit.casefold()]
    amount = quantize_currency(amount, currency)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="The expense amount must be greater than zero.")
    return amount


def explicit_currency_code(text: str) -> str | None:
    code_match = re.search(r"(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])", text)
    if code_match:
        return code_match.group(1)
    match = re.search(
        r"₹|\$|€|£|\bINR\b|\bUSD\b|\bEUR\b|\bGBP\b|\brupees?\b|\brs\.?\b|\bdollars?\b|\beuros?\b|\bpounds?\b",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    token = match.group(0).casefold()
    if token in {"₹", "inr", "rupee", "rupees", "rs", "rs."}:
        return "INR"
    if token in {"$", "usd", "dollar", "dollars"}:
        return "USD"
    if token in {"€", "eur", "euro", "euros"}:
        return "EUR"
    return "GBP"


def has_indian_scale_unit(text: str) -> bool:
    return bool(re.search(r"\b(?:lakhs?|lacs?|crores?|cr|hazar|hazaar|hajaar)\b|लाख|লাখ|લાખ|ਲੱਖ|லட்சம்|இலட்சம்|లక్ష|లక్షలు|ಲಕ್ಷ|ലക്ഷം|करोड़|करोड|करोड़|কোটি|કરોડ|ਕਰੋੜ|கோடி|కోటి|ಕೋಟಿ|കോടി|हजार|हज़ार|हज़ار", text, re.IGNORECASE))


def parse_expense_text(text: str, default_currency: str = "INR") -> ExpensePayload:
    """Deterministic structured extraction for common English and Hindi-family expense phrases."""
    source = " ".join(text.strip().split())
    currency_token = r"(?:₹|\$|€|£|(?-i:\b[A-Z]{3}\b)|\brupees?\b|\brs\.?\b|\bdollars?\b|\beuros?\b|\bpounds?\b)"
    number_token = r"([0-9०-९][0-9०-९,]*(?:\.[0-9०-९]+)?)"
    unit_token = r"(thousands?|hazar|hazaar|hajaar|हजार|हज़ार|हज़ार|lakhs?|lacs?|लाख|লাখ|લાખ|ਲੱਖ|லட்சம்|இலட்சம்|లక్షలు|లక్ష|ಲಕ್ಷ|ലക്ഷം|crores?|cr|करोड़|करोड|करोड़|কোটি|કરોડ|ਕਰੋڑ|கோடி|కోటి|ಕೋಟಿ|കോടി|millions?|billions?)"
    money_match = re.search(rf"(?:{currency_token}\s*)?{number_token}(?:\s*{unit_token})?\s*(?:{currency_token})?", source, re.IGNORECASE)
    if not money_match:
        raise HTTPException(status_code=422, detail="I couldn't find an amount in that expense.")
    currency_code = explicit_currency_code(money_match.group(0))
    unit = money_match.group(2)
    currency = currency_code or ("INR" if unit and has_indian_scale_unit(unit) else default_currency.upper())
    amount = parse_spoken_amount(money_match.group(1), unit, currency)

    before_amount = source[:money_match.start()].strip(" ,:;—-")
    after_amount = source[money_match.end():].strip(" ,:;—-")
    payer_match = re.search(r"(?i)(?:^|\b)([\w][\w.'-]*(?:\s+[\w][\w.'-]*){0,2})\s+(?:paid|spent|payed|दे|दिया|दिए)\s*$", before_amount)
    if payer_match:
        payer = payer_match.group(1).strip()
        description_prefix = before_amount[:payer_match.start()].strip()
    else:
        payer_match = re.search(r"(?i)^([\w][\w.'-]*)\s+(?:paid|spent|payed)\b", before_amount)
        payer = payer_match.group(1) if payer_match else "You"
        description_prefix = ""

    shared_match = re.search(r"(?i)\b(?:shared\s+with|split\s+with|among|for\s+me\s+and|with)\s+(.+)$", after_amount)
    if not shared_match:
        shared_match = re.search(r"(?i)\b(?:shared\s+with|split\s+with|among|with)\s+(.+)$", source)
    shared: list[str] = []
    if shared_match:
        people_text = re.sub(r"[.!?]+$", "", shared_match.group(1)).strip()
        shared = [name.strip(" ,&") for name in re.split(r"\s*,\s*|\s+and\s+|\s*&\s*", people_text, flags=re.I) if name.strip(" ,&")]
    shared = [name for name in shared if name.casefold() != payer.casefold()]

    description_source = (description_prefix + " " + after_amount).strip()
    description_source = re.sub(r"(?i)\b(?:shared\s+with|split\s+with|among|with)\s+.+$", "", description_source).strip(" ,:;—-")
    description = description_source or "Shared expense"
    if description.casefold().startswith(("for ", "on ")):
        description = description[4:] if description.casefold().startswith("for ") else description[3:]
    return ExpensePayload(payer=payer, amount=amount, currency=currency, shared_with=shared[:30], description=description[:160] or "Shared expense")


@app.get("/api/health")
async def health() -> dict[str, str | bool]:
    return {"status": "ok", "service": "wepay-api", "live_voice_configured": bool(os.getenv("GEMINI_API_KEY", "").strip())}



@app.websocket("/ws/ledger")
async def ledger_socket(socket: WebSocket) -> None:
    origin = socket.headers.get("origin")

    # Reject unknown or missing origins.
    if not origin or origin not in FRONTEND_ORIGINS:
        logger.warning(
            "WebSocket connection rejected: origin=%r",
            origin,
        )
        await socket.close(
            code=1008,
            reason="Origin is not allowed",
        )
        return

    # Accept/register the connection through your manager.
    await ledger_manager.connect(socket)

    try:
        while True:
            message = await socket.receive_json()

            if not isinstance(message, dict):
                await socket.send_json({
                    "type": "error",
                    "message": (
                        "Send a JSON object over the ledger socket."
                    ),
                })
                continue

            operation = message.get("type")
            request_id = str(message.get("requestId", ""))[:80]

            # Heartbeat
            if operation == "ping":
                await socket.send_json({
                    "type": "pong",
                    "requestId": request_id,
                })
                continue

            # Refresh forex rates
            if operation == "forex.refresh":
                base_currency = str(
                    message.get("base", "USD")
                ).upper()

                if not re.fullmatch(r"[A-Z]{3}", base_currency):
                    await socket.send_json({
                        "type": "forex.error",
                        "requestId": request_id,
                        "message": (
                            "The reference currency must be "
                            "a three-letter ISO code."
                        ),
                    })
                    continue

                try:
                    rates = await exchange_rates(base_currency)
                    await ledger_manager.publish({
                        "type": "forex.rates",
                        "rates": rates,
                    })
                except HTTPException as exc:
                    await socket.send_json({
                        "type": "forex.error",
                        "requestId": request_id,
                        "message": str(exc.detail),
                    })
                continue

            # Parse a text expense
            if operation == "expense.parse":
                text = message.get("text")
                currency = str(
                    message.get("currency", "USD")
                ).upper()

                if (
                    not isinstance(text, str)
                    or not text.strip()
                    or len(text) > 1000
                ):
                    await socket.send_json({
                        "type": "expense.error",
                        "requestId": request_id,
                        "message": (
                            "Enter an expense description between "
                            "1 and 1000 characters."
                        ),
                    })
                    continue

                if not re.fullmatch(r"[A-Z]{3}", currency):
                    await socket.send_json({
                        "type": "expense.error",
                        "requestId": request_id,
                        "message": (
                            "Currency must be a three-letter code."
                        ),
                    })
                    continue

                try:
                    expense = parse_expense_text(
                        text,
                        default_currency=currency,
                    )
                    expense = await convert_expense_currency(
                        expense,
                        currency,
                    )
                    signals = await analyze_expense(expense)

                    parsed = ParseVoiceResponse(
                        **expense.model_dump(),
                        liabilities=calculate_liabilities(expense),
                        **signals,
                    )

                    await socket.send_json({
                        "type": "expense.parsed",
                        "requestId": request_id,
                        "expense": parsed.model_dump(mode="json"),
                    })

                except HTTPException as exc:
                    await socket.send_json({
                        "type": "expense.error",
                        "requestId": request_id,
                        "message": str(exc.detail),
                    })
                except Exception:
                    logger.exception(
                        "WebSocket expense parsing failed"
                    )
                    await socket.send_json({
                        "type": "expense.error",
                        "requestId": request_id,
                        "message": (
                            "We could not parse that expense. "
                            "Please review the text and try again."
                        ),
                    })
                continue

            # Process a voice expense
            if operation == "voice.process":
                audio_base64 = message.get("audioBase64")
                mime_type = str(
                    message.get("mimeType", "")
                ).split(";", 1)[0].lower()
                currency = str(
                    message.get("currency", "USD")
                ).upper()

                if (
                    not isinstance(audio_base64, str)
                    or not audio_base64
                    or len(audio_base64) > 14_000_000
                ):
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": (
                            "Audio must be a valid recording "
                            "no larger than 10 MB."
                        ),
                    })
                    continue

                if mime_type not in SUPPORTED_AUDIO_MIME_TYPES:
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": (
                            "This browser audio format is not supported. "
                            "Try recording again."
                        ),
                    })
                    continue

                if not re.fullmatch(r"[A-Z]{3}", currency):
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": (
                            "Currency must be a three-letter code."
                        ),
                    })
                    continue

                if not os.getenv("GEMINI_API_KEY", "").strip():
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": (
                            "Live voice is not configured. "
                            "Add GEMINI_API_KEY to the backend "
                            "environment variables."
                        ),
                    })
                    continue

                try:
                    audio_bytes = base64.b64decode(
                        audio_base64,
                        validate=True,
                    )

                    if (
                        not audio_bytes
                        or len(audio_bytes) > 10 * 1024 * 1024
                    ):
                        raise ValueError(
                            "Audio payload size was invalid"
                        )

                    gemini_client: httpx.AsyncClient = (
                        socket.app.state.gemini_client
                    )

                    transcript = await transcribe_audio(
                        audio_bytes,
                        mime_type,
                        gemini_client,
                    )

                    extraction, parser_fallback = (
                        await extract_expense_with_llm(
                            transcript,
                            currency,
                            gemini_client,
                        )
                    )

                    expense = ExpensePayload(
                        **extraction.model_dump()
                    )

                    if not parser_fallback:
                        expense = await convert_expense_currency(
                            expense,
                            currency,
                        )

                    signals = (
                        await analyze_expense(expense)
                        if not parser_fallback
                        else {
                            "fraud_risk": "LOW",
                            "volatility_index": None,
                            "hedging_advice": None,
                            "hedging_hold_recommended": False,
                        }
                    )

                    response = LiveVoiceResponse(
                        **expense.model_dump(),
                        liabilities=calculate_liabilities(expense),
                        transcript=transcript,
                        parserFallback=parser_fallback,
                        **signals,
                    )

                    await socket.send_json({
                        "type": "voice.processed",
                        "requestId": request_id,
                        "result": response.model_dump(mode="json"),
                    })

                except (ValueError, binascii.Error):
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": (
                            "The audio payload was invalid. "
                            "Please record it again."
                        ),
                    })
                except HTTPException as exc:
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": str(exc.detail),
                    })
                except Exception:
                    logger.exception(
                        "WebSocket live voice processing failed"
                    )
                    await socket.send_json({
                        "type": "voice.error",
                        "requestId": request_id,
                        "message": (
                            "Could not transcribe this recording. "
                            "Please try again or type the expense."
                        ),
                    })
                continue

            # Unknown operation
            await socket.send_json({
                "type": "error",
                "requestId": request_id,
                "message": "Unsupported ledger socket operation.",
            })

    except WebSocketDisconnect:
        logger.info("Ledger WebSocket disconnected")

    except Exception:
        logger.exception(
            "Ledger WebSocket connection ended unexpectedly"
        )

    finally:
        await ledger_manager.disconnect(socket)

@app.get("/api/settings/defaults", response_model=UserSettingsPayload)
async def settings_defaults() -> UserSettingsPayload:
    return UserSettingsPayload()


@app.post("/api/settings/validate", response_model=UserSettingsPayload)
async def validate_settings(settings: UserSettingsPayload) -> UserSettingsPayload:
    return settings


@app.get("/api/paypal/config-status")
async def paypal_config_status() -> dict[str, bool | str]:
    runtime = PAYPAL_RUNTIME_CREDENTIALS
    client_id = runtime[0] if runtime else os.getenv("PAYPAL_CLIENT_ID", "").strip()
    secret = runtime[1] if runtime else os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
    configured = bool(client_id and secret)
    source = "session" if runtime else "environment" if configured else "missing"
    return {"configured": configured, "source": source, "client_id": client_id if configured else "", "checkout_currency": paypal_checkout_currency()}


@app.post("/api/paypal/config")
async def save_paypal_config(credentials: PayPalCredentialInput, request: Request) -> dict[str, bool | str]:
    """Save sandbox credentials to this local backend's private .env file."""
    global PAYPAL_RUNTIME_CREDENTIALS
    if request.client is None or request.client.host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(status_code=403, detail="Credential setup is only available from this computer.")

    env_path = Path(__file__).with_name(".env")
    preserved_lines = []
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if not re.match(r"^\s*(PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET)\s*=", line):
                preserved_lines.append(line)
    encoded_id = json.dumps(credentials.client_id)
    encoded_secret = json.dumps(credentials.client_secret)
    env_lines = [f"PAYPAL_CLIENT_ID={encoded_id}", f"PAYPAL_CLIENT_SECRET={encoded_secret}", *preserved_lines]
    env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
    PAYPAL_RUNTIME_CREDENTIALS = (credentials.client_id, credentials.client_secret)
    return {"configured": True, "source": "local file", "client_id": credentials.client_id}


@app.get("/api/exchange-rates")
async def exchange_rates(base: str = "USD") -> dict:
    """Return cached reference rates for every currency currently quoted by Frankfurter."""
    base = base.upper()
    if not re.fullmatch(r"[A-Z]{3}", base):
        raise HTTPException(status_code=422, detail="Base currency must be a three-letter ISO code.")
    cached = FX_CACHE.get(base)
    if cached and time.monotonic() - cached[0] < 3600:
        return cached[1]
    async with httpx.AsyncClient(base_url=FX_API_BASE, timeout=httpx.Timeout(15.0, connect=4.0)) as client:
        try:
            response = await client.get("/v2/rates", params={"base": base})
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("Unexpected exchange-rate response")
            rates: dict[str, float] = {base: 1.0}
            dates: list[str] = []
            for row in rows:
                if not isinstance(row, dict) or row.get("base") != base:
                    continue
                quote = row.get("quote")
                rate = row.get("rate")
                if isinstance(quote, str) and re.fullmatch(r"[A-Z]{3}", quote) and isinstance(rate, (int, float)) and math.isfinite(rate) and rate > 0:
                    rates[quote] = float(rate)
                    if isinstance(row.get("date"), str):
                        dates.append(row["date"])
            if not dates:
                raise ValueError("No exchange rates are available for the requested base currency")
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="Reference exchange rates are temporarily unavailable.") from exc
    data = {"base": base, "date": max(dates) if dates else None, "rates": rates}
    FX_CACHE[base] = (time.monotonic(), data)
    return data


@app.get("/api/currencies")
async def available_currencies() -> list[dict[str, str]]:
    """Return active three-letter currency codes with reference-rate provider coverage."""
    global FX_CURRENCIES_CACHE
    cached = FX_CURRENCIES_CACHE
    if cached and time.monotonic() - cached[0] < 86400:
        return cached[1]
    async with httpx.AsyncClient(base_url=FX_API_BASE, timeout=httpx.Timeout(15.0, connect=4.0)) as client:
        try:
            response = await client.get("/v2/currencies")
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("Unexpected currency catalogue response")
            options = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                code = str(row.get("iso_code", "")).upper()
                name = str(row.get("name", "")).strip()
                symbol = str(row.get("symbol", "")).strip()
                if re.fullmatch(r"[A-Z]{3}", code) and name:
                    options.append({"code": code, "name": name, "symbol": symbol})
            if not options:
                raise ValueError("Currency catalogue contains no active currencies")
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="The active currency catalogue is temporarily unavailable.") from exc
    options.sort(key=lambda option: (option["name"].casefold(), option["code"]))
    FX_CURRENCIES_CACHE = (time.monotonic(), options)
    return options


async def convert_expense_currency(expense: ExpensePayload, target_currency: str) -> ExpensePayload:
    target_currency = target_currency.upper()
    if not re.fullmatch(r"[A-Z]{3}", target_currency):
        raise HTTPException(status_code=422, detail="Selected currency must be a three-letter ISO code.")
    source_currency = expense.currency.upper()
    if source_currency == target_currency:
        return expense
    source_rates = await exchange_rates(base=source_currency)
    raw_rate = source_rates["rates"].get(target_currency)
    if raw_rate is None:
        raise HTTPException(status_code=422, detail=f"Reference conversion from {source_currency} to {target_currency} is unavailable.")
    rate = Decimal(str(raw_rate))
    converted_amount = quantize_currency(expense.amount * rate, target_currency)
    if converted_amount <= 0:
        raise HTTPException(status_code=422, detail="Converted expense amount is below the smallest supported currency unit.")
    return ExpensePayload(
        **expense.model_dump(exclude={"amount", "currency", "original_amount", "original_currency", "exchange_rate", "exchange_rate_date"}),
        amount=converted_amount,
        currency=target_currency,
        original_amount=expense.amount,
        original_currency=source_currency,
        exchange_rate=rate,
        exchange_rate_date=source_rates.get("date"),
    )


async def fraud_risk_for_expense(expense: ExpensePayload) -> Literal["LOW", "HIGH"]:
    """Flag a split when any participant's exact share exceeds USD 500."""
    usd_expense = await convert_expense_currency(expense, "USD")
    usd_liabilities = calculate_liabilities(usd_expense)
    return "HIGH" if any(share.amount > Decimal("500") for share in usd_liabilities) else "LOW"


async def forex_volatility_for_currency(currency: str) -> dict[str, str | float | bool | None]:
    """Measure annualized sample volatility from the last 45 calendar days of USD rates."""
    quote_currency = currency.upper()
    if quote_currency == "USD":
        return {"volatility_index": 0.0, "hedging_advice": None, "hedging_hold_recommended": False}

    cached = FX_VOLATILITY_CACHE.get(quote_currency)
    if cached and time.monotonic() - cached[0] < 900:
        return dict(cached[1])

    end_day = date.today()
    start_day = end_day - timedelta(days=45)
    async with httpx.AsyncClient(base_url=FX_API_BASE, timeout=httpx.Timeout(15.0, connect=4.0)) as client:
        try:
            response = await client.get(
                "/v2/rates",
                params={"base": "USD", "quotes": quote_currency, "from": start_day.isoformat(), "to": end_day.isoformat()},
            )
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("Historical exchange-rate response was not a list")
            observations: dict[str, float] = {}
            for row in rows:
                if not isinstance(row, dict) or row.get("base") != "USD" or row.get("quote") != quote_currency:
                    continue
                rate = row.get("rate")
                rate_date = row.get("date")
                if isinstance(rate_date, str) and isinstance(rate, (int, float)) and math.isfinite(rate) and rate > 0:
                    observations[rate_date] = float(rate)
            values = [observations[key] for key in sorted(observations)]
            if len(values) < 5:
                result = {"volatility_index": None, "hedging_advice": None, "hedging_hold_recommended": False}
                FX_VOLATILITY_CACHE[quote_currency] = (time.monotonic(), result)
                return result

            returns = [math.log(current / previous) for previous, current in zip(values, values[1:])]
            average_return = sum(returns) / len(returns)
            sample_variance = sum((value - average_return) ** 2 for value in returns) / max(1, len(returns) - 1)
            annualized_percent = math.sqrt(sample_variance) * math.sqrt(252) * 100
            hold_recommended = annualized_percent >= FX_VOLATILITY_THRESHOLD_PERCENT
            advice = (
                "Elevated 45-day USD exchange-rate volatility detected. An optional 4-hour review hold is recommended; rates may move either way and savings are not guaranteed."
                if hold_recommended
                else None
            )
            result = {
                "volatility_index": round(annualized_percent, 4),
                "hedging_advice": advice,
                "hedging_hold_recommended": hold_recommended,
            }
            FX_VOLATILITY_CACHE[quote_currency] = (time.monotonic(), result)
            return result
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            logger.warning("Could not calculate USD/%s historical volatility (%s)", quote_currency, type(exc).__name__)
            return {"volatility_index": None, "hedging_advice": None, "hedging_hold_recommended": False}


async def analyze_expense(expense: ExpensePayload) -> dict[str, str | float | bool | None]:
    fraud_risk, volatility = await asyncio.gather(
        fraud_risk_for_expense(expense),
        forex_volatility_for_currency(expense.currency),
    )
    return {"fraud_risk": fraud_risk, **volatility}


@app.post("/api/parse-voice", response_model=ParseVoiceResponse)
async def parse_voice(request: VoiceInputRequest, target_currency: str = "USD") -> ParseVoiceResponse:
    target_currency = target_currency.strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", target_currency):
        raise HTTPException(status_code=422, detail="Selected currency must be a three-letter ISO code.")
    expense = parse_expense_text(request.text, default_currency=target_currency)
    expense = await convert_expense_currency(expense, target_currency)
    signals = await analyze_expense(expense)
    return ParseVoiceResponse(**expense.model_dump(), liabilities=calculate_liabilities(expense), **signals)


def gemini_output_text(payload: dict) -> str:
    if not isinstance(payload, dict):
        raise ValueError("Gemini interaction response was not an object")
    blocks = []
    direct_text = payload.get("output_text")
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()
    for step in payload.get("steps", []):
        if isinstance(step, dict) and step.get("type") == "model_output":
            content = step.get("content", [])
            if isinstance(content, list):
                blocks.extend(
                    item.get("text", "")
                    for item in content
                    if isinstance(item, dict) and item.get("type") in {"text", "json"} and isinstance(item.get("text"), str)
                )
                blocks.extend(
                    json.dumps(item["json"], ensure_ascii=False)
                    for item in content
                    if isinstance(item, dict) and isinstance(item.get("json"), dict)
                )
    for output in payload.get("outputs", []):
        if isinstance(output, dict) and output.get("type") in {"text", "json"} and isinstance(output.get("text"), str):
            blocks.append(output["text"])
        if isinstance(output, dict) and isinstance(output.get("json"), dict):
            blocks.append(json.dumps(output["json"], ensure_ascii=False))
    output_text = "\n".join(part for part in blocks if part).strip()
    if output_text:
        return output_text
    status = payload.get("status")
    if status and str(status).casefold() != "completed":
        raise ValueError(f"Gemini interaction returned status {str(status)[:40]}")
    raise ValueError("Gemini interaction contained no text or JSON output")


async def wait_for_gemini_interaction(payload: dict, client: httpx.AsyncClient, api_key: str) -> dict:
    """Poll Gemini background interactions until completion, with a fixed 30 second cap."""
    if not isinstance(payload, dict):
        raise ValueError("Gemini interaction response was not an object")
    deadline = time.monotonic() + 30.0
    current = payload
    while str(current.get("status", "")).casefold() == "in_progress":
        interaction_id = current.get("id")
        if not isinstance(interaction_id, str) or not interaction_id:
            raise ValueError("Gemini in-progress response did not include an interaction ID")
        if time.monotonic() >= deadline:
            raise TimeoutError("Gemini interaction did not complete before the polling deadline")
        await asyncio.sleep(0.5)
        response = await client.get(
            f"/v1beta/interactions/{quote(interaction_id, safe='')}",
            headers={"x-goog-api-key": api_key},
        )
        response.raise_for_status()
        current = response.json()
        if not isinstance(current, dict):
            raise ValueError("Gemini interaction poll returned an invalid response")
    return current


async def upload_gemini_audio(audio_bytes: bytes, mime_type: str, client: httpx.AsyncClient, api_key: str) -> tuple[str, str]:
    filename, normalized_mime = SUPPORTED_AUDIO_MIME_TYPES[mime_type]
    try:
        start = await client.post(
            "/upload/v1beta/files",
            headers={
                "x-goog-api-key": api_key,
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(len(audio_bytes)),
                "X-Goog-Upload-Header-Content-Type": normalized_mime,
                "Content-Type": "application/json",
            },
            json={"file": {"display_name": filename}},
        )
        start.raise_for_status()
        upload_url = start.headers.get("x-goog-upload-url", "")
        parsed_url = urlsplit(upload_url)
        if parsed_url.scheme != "https" or parsed_url.hostname != "generativelanguage.googleapis.com":
            raise ValueError("Gemini returned an invalid upload URL")
        uploaded = await client.post(
            upload_url,
            headers={
                "x-goog-api-key": api_key,
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
                "Content-Length": str(len(audio_bytes)),
                "Content-Type": normalized_mime,
            },
            content=audio_bytes,
        )
        uploaded.raise_for_status()
        file_info = uploaded.json().get("file", {})
        file_uri = file_info.get("uri")
        file_name = file_info.get("name")
        if not file_uri or not file_name:
            raise ValueError("Gemini returned incomplete uploaded file metadata")
        return file_uri, file_name
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=503, detail="Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.") from exc
        raise HTTPException(status_code=502, detail="Gemini could not upload this recording. Please retry with a shorter recording.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Gemini audio upload could not be reached.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Gemini returned invalid audio upload metadata.") from exc


async def transcribe_audio(audio_bytes: bytes, mime_type: str, client: httpx.AsyncClient) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Live voice is not configured. Add GEMINI_API_KEY to backend/.env and restart the backend.")
    file_uri, file_name = await upload_gemini_audio(audio_bytes, mime_type, client, api_key)
    try:
        response = await client.post(
            "/v1beta/interactions",
            headers={"x-goog-api-key": api_key},
            json={
                "model": GEMINI_TRANSCRIBE_MODEL,
                "input": [{"type": "audio", "uri": file_uri, "mime_type": SUPPORTED_AUDIO_MIME_TYPES[mime_type][1]}],
                "generation_config": {"transcription_config": {"language_codes": [], "mode": {"type": "verbatim"}}},
            },
        )
        response.raise_for_status()
        interaction = await wait_for_gemini_interaction(response.json(), client, api_key)
        transcript = gemini_output_text(interaction)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=503, detail="Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.") from exc
        raise HTTPException(status_code=502, detail="Gemini could not transcribe this audio. Record a clearer, shorter phrase and retry.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="The Gemini transcription service could not be reached.") from exc
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an invalid transcription response.") from exc
    finally:
        try:
            await client.delete(f"/v1beta/{file_name}", headers={"x-goog-api-key": api_key})
        except httpx.HTTPError:
            pass
    if not transcript:
        raise HTTPException(status_code=422, detail="No speech was detected. Try speaking closer to the microphone.")
    return transcript


async def extract_expense_with_llm(transcript: str, default_currency: str, client: httpx.AsyncClient) -> tuple[AIExpenseExtraction, bool]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Live voice is not configured. Add GEMINI_API_KEY to backend/.env and restart the backend.")
    system_prompt = (
        "You are a deterministic financial extraction tool for global family shared accounts. Analyze the multilingual text input "
        "(which can be a mix of Hindi, English, or Hinglish) and precisely isolate financial parameters into a strict JSON payload "
        "containing only: 'payer' (string identifying who spent money), 'amount' (float numerical value), 'currency' "
        "(standard 3-letter capital currency code derived from names or symbols like ₹=INR, $=USD), 'shared_with' "
        "(array of strings pinpointing individual target split members mentioned), and 'description' (short expense label). "
        "If no clear split list exists, extrapolate logical "
        "relations from descriptors like 'sabme' or 'family'. Use the group label 'Family' for those descriptors only when no "
        "individual names are spoken. Never invent individual people or infer a payment amount that is not present. "
        "Normalize Indian magnitude words exactly: 1 lakh/lac is 100000, 1 crore is 10000000, and 1 hazaar/hazar is 1000. "
        "When an Indian magnitude is used without an explicit currency, treat the source amount as INR. Preserve explicit "
        "spoken source currencies. If no currency and no Indian magnitude are spoken, use the selected target currency "
        f"{default_currency}. The server converts the source amount to that selected target currency using its current reference rate."
    )
    schema = {
        "type": "object",
        "properties": {
            "payer": {"type": "string"},
            "amount": {"type": "number"},
            "currency": {"type": "string"},
            "shared_with": {"type": "array", "items": {"type": "string"}},
            "description": {"type": "string"},
        },
        "required": ["payer", "amount", "currency", "shared_with", "description"],
        "additionalProperties": False,
    }
    try:
        response = await client.post(
            "/v1beta/interactions",
            headers={"x-goog-api-key": api_key},
            json={
                "model": GEMINI_EXPENSE_MODEL,
                "input": transcript,
                "system_instruction": system_prompt,
                "generation_config": {"temperature": 0, "max_output_tokens": 250},
                "response_format": {"type": "text", "mime_type": "application/json", "schema": schema},
            },
        )
        response.raise_for_status()
        try:
            interaction = await wait_for_gemini_interaction(response.json(), client, api_key)
            raw_output = gemini_output_text(interaction)
        except Exception as exc:
            logger.warning("Gemini output was not ready or readable; fallback values require user review (%s)", type(exc).__name__)
            raw_output = ""
        normalized_payload, fallback_used = normalize_gemini_expense(raw_output)
        extraction = None
        if fallback_used:
            try:
                recovered = parse_expense_text(transcript, default_currency=default_currency)
                if not recovered.shared_with:
                    raise ValueError("The transcript did not identify any split members")
                explicit_currency = explicit_currency_code(transcript)
                if not explicit_currency:
                    recovered.currency = default_currency
                extraction = AIExpenseExtraction.model_validate({
                    "payer": recovered.payer,
                    "amount": float(recovered.amount),
                    "currency": recovered.currency,
                    "shared_with": recovered.shared_with,
                    "description": recovered.description,
                })
                fallback_used = False
                logger.info("Gemini output was unusable; deterministic transcript parser recovered a complete split")
            except Exception as exc:
                logger.warning("Transcript recovery could not verify a complete split (%s)", type(exc).__name__)
        if extraction is None:
            try:
                extraction = AIExpenseExtraction.model_validate(normalized_payload)
            except Exception as exc:
                logger.warning("Gemini normalized expense failed validation; using fixed review defaults (%s)", type(exc).__name__)
                extraction = AIExpenseExtraction.model_validate({
                    "payer": "Family Member",
                    "amount": 20.00,
                    "currency": "USD",
                    "shared_with": ["Rahul", "Amit"],
                    "description": "WePay Unified Ledger Entry",
                })
                fallback_used = True
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=503, detail="Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.") from exc
        raise HTTPException(status_code=502, detail="Gemini could not structure the transcribed expense. Please retry.") from exc
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="The expense parser returned an invalid response. Please retry.") from exc
    if extraction.shared_with and any(name.casefold() == extraction.payer.casefold() for name in extraction.shared_with):
        extraction.shared_with = [name for name in extraction.shared_with if name.casefold() != extraction.payer.casefold()]
    if len({name.casefold() for name in [extraction.payer, *extraction.shared_with]}) != len(extraction.shared_with) + 1:
        raise HTTPException(status_code=422, detail="The parsed split contains duplicate people. Please say the names again.")
    spoken_currency = explicit_currency_code(transcript)
    if has_indian_scale_unit(transcript):
        try:
            spoken_amount = parse_expense_text(transcript, default_currency=default_currency)
            extraction.amount = spoken_amount.amount
        except HTTPException:
            logger.info("Indian amount words were present but could not be fully normalized from transcript digits")
    if spoken_currency:
        extraction.currency = spoken_currency
    elif has_indian_scale_unit(transcript):
        extraction.currency = "INR"
    else:
        extraction.currency = default_currency
    return extraction, fallback_used


async def read_bounded_audio(request: Request) -> tuple[bytes, str]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in SUPPORTED_AUDIO_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio format. Record audio as WebM, MP4, OGG, MP3, or WAV.")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="Audio recordings must be 15 MB or smaller.")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid audio content length.") from exc
    parts: list[bytes] = []
    total_bytes = 0
    async for part in request.stream():
        total_bytes += len(part)
        if total_bytes > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio recordings must be 15 MB or smaller.")
        parts.append(part)
    audio_bytes = b"".join(parts)
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="The microphone recording was empty. Please record again.")
    return audio_bytes, content_type


@app.post("/api/process-live-voice", response_model=LiveVoiceResponse)
async def process_live_voice(request: Request, default_currency: str = "USD") -> LiveVoiceResponse:
    default_currency = default_currency.strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", default_currency):
        raise HTTPException(status_code=422, detail="Default currency must be a three-letter ISO code.")
    if not os.getenv("GEMINI_API_KEY", "").strip():
        raise HTTPException(status_code=503, detail="Live voice is not configured. Add GEMINI_API_KEY to backend/.env and restart the backend.")
    audio_bytes, mime_type = await read_bounded_audio(request)
    gemini_client: httpx.AsyncClient = request.app.state.gemini_client
    transcript = await transcribe_audio(audio_bytes, mime_type, gemini_client)
    extraction, parser_fallback = await extract_expense_with_llm(transcript, default_currency, gemini_client)
    expense = ExpensePayload(
        payer=extraction.payer,
        amount=extraction.amount,
        currency=extraction.currency,
        shared_with=extraction.shared_with,
        description=extraction.description,
    )
    if not parser_fallback:
        expense = await convert_expense_currency(expense, default_currency)
    return_url, cancel_url = paypal_return_urls(request)
    signals = await analyze_expense(expense) if not parser_fallback else {"fraud_risk": "LOW", "volatility_index": None, "hedging_advice": None, "hedging_hold_recommended": False}
    order = None
    if not parser_fallback and signals["fraud_risk"] == "LOW" and not signals["hedging_hold_recommended"]:
        order = await create_paypal_order_for_expense(expense, return_url, cancel_url, signals)
    return LiveVoiceResponse(
        **expense.model_dump(),
        liabilities=calculate_liabilities(expense),
        transcript=transcript,
        orderId=order.orderId if order else None,
        checkoutUrl=order.approvalUrl if order else None,
        checkoutAmount=order.amount if order else None,
        checkoutCurrency=order.currency if order else None,
        parserFallback=parser_fallback,
        **signals,
    )


async def paypal_access_token(client: httpx.AsyncClient) -> str:
    runtime_credentials = PAYPAL_RUNTIME_CREDENTIALS
    client_id = (runtime_credentials[0] if runtime_credentials else os.getenv("PAYPAL_CLIENT_ID", "")).strip()
    secret = (runtime_credentials[1] if runtime_credentials else os.getenv("PAYPAL_CLIENT_SECRET", "")).strip()
    if not client_id or not secret:
        raise HTTPException(status_code=503, detail="PayPal sandbox credentials are not configured on the server.")
    try:
        response = await client.post("/v1/oauth2/token", data={"grant_type": "client_credentials"}, auth=(client_id, secret), headers={"Accept": "application/json", "Accept-Language": "en_US"})
        response.raise_for_status()
        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise ValueError("PayPal did not return an access token")
        return token
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="PayPal authentication failed. Check the sandbox credentials and try again.") from exc


async def create_paypal_order_for_expense(
    expense: ExpensePayload,
    return_url: str | None = None,
    cancel_url: str | None = None,
    signals: dict[str, str | float | bool | None] | None = None,
) -> CreateOrderResponse:
    # Calculate exact participant shares before any external payment request is created.
    liabilities = calculate_liabilities(expense)
    signals = signals or await analyze_expense(expense)
    source_currency = expense.currency.upper()
    source_amount = quantize_currency(expense.amount, source_currency)
    checkout_expense = await convert_expense_currency(expense, paypal_checkout_currency())
    total = quantize_currency(checkout_expense.amount, checkout_expense.currency)
    request_id = str(uuid.uuid4())
    async with httpx.AsyncClient(base_url=PAYPAL_API_BASE, timeout=httpx.Timeout(20.0, connect=5.0)) as client:
        token = await paypal_access_token(client)
        order_payload = {
            "intent": "CAPTURE",
            "purchase_units": [{
                "reference_id": request_id,
                "description": expense.description[:127],
                "amount": {"currency_code": checkout_expense.currency, "value": format_currency_amount(total, checkout_expense.currency)},
                "custom_id": f"wepay-{request_id}",
            }],
            "application_context": {
                "brand_name": "WePay.ai",
                "shipping_preference": "NO_SHIPPING",
                "user_action": "PAY_NOW",
                **({"return_url": return_url} if return_url else {}),
                **({"cancel_url": cancel_url} if cancel_url else {}),
            },
        }
        try:
            response = await client.post(
                "/v2/checkout/orders",
                json=order_payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "PayPal-Request-Id": request_id},
            )
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as exc:
            try:
                error_payload = exc.response.json()
            except ValueError:
                error_payload = {}
            if not isinstance(error_payload, dict):
                error_payload = {}
            details = error_payload.get("details", []) if isinstance(error_payload, dict) else []
            first_detail = details[0] if details and isinstance(details[0], dict) else {}
            issue = str(first_detail.get("issue") or error_payload.get("name") or "PAYPAL_ORDER_REJECTED")
            description = str(first_detail.get("description") or error_payload.get("message") or "PayPal rejected this order.")
            debug_id = str(error_payload.get("debug_id") or "")
            logger.warning("PayPal order rejected status=%s issue=%s debug_id=%s", exc.response.status_code, issue, debug_id or "none")
            safe_detail = re.sub(r"[\r\n\x00-\x1f]+", " ", description).strip()[:240]
            debug_suffix = f" PayPal reference: {debug_id}." if debug_id else ""
            raise HTTPException(status_code=502, detail=f"PayPal rejected the order ({issue}): {safe_detail}{debug_suffix}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="PayPal could not be reached. Please try again.") from exc

    order_id = result.get("id")
    approval_url = next((link.get("href", "") for link in result.get("links", []) if link.get("rel") == "approve"), "")
    if not order_id or not approval_url:
        raise HTTPException(status_code=502, detail="PayPal returned an incomplete checkout order.")
    return CreateOrderResponse(
        orderId=order_id,
        approvalUrl=approval_url,
        amount=format_currency_amount(total, checkout_expense.currency),
        currency=checkout_expense.currency,
        sourceAmount=format_currency_amount(source_amount, source_currency),
        sourceCurrency=source_currency,
        exchangeRate=str(checkout_expense.exchange_rate) if checkout_expense.exchange_rate is not None else None,
        exchangeRateDate=checkout_expense.exchange_rate_date,
        liabilities=liabilities,
        requestId=request_id,
        **signals,
    )


@app.post("/api/create-paypal-order", response_model=CreateOrderResponse)
async def create_paypal_order(expense: ExpensePayload, request: Request) -> CreateOrderResponse:
    return_url, cancel_url = paypal_return_urls(request)
    signals = await analyze_expense(expense)
    if signals["fraud_risk"] == "HIGH" and not expense.high_risk_acknowledged:
        raise HTTPException(status_code=409, detail="This split exceeds the USD 500 per-person review threshold. Confirm the high-value review before creating a PayPal order.")
    if signals["hedging_hold_recommended"] and not expense.hedging_override_acknowledged:
        raise HTTPException(status_code=409, detail="Recent FX volatility is elevated. Review the optional hold recommendation or explicitly proceed now.")
    order = await create_paypal_order_for_expense(expense, return_url, cancel_url, signals)
    row = await ledger_manager.add_expense(expense, event_id=order.orderId)
    if expense.shared_with:
        message = f"AI Collection Pinger: {', '.join(expense.shared_with)} have a pending share for {expense.description} paid by {expense.payer}."
        await asyncio.gather(
            ledger_manager.publish({"type": "ledger.expense", "expense": row}),
            ledger_manager.publish({"type": "collection.pinger", "ledgerId": row["id"], "message": message, "members": expense.shared_with}),
        )
    else:
        await ledger_manager.publish({"type": "ledger.expense", "expense": row})
    return order


@app.post("/api/paypal/capture")
async def capture_paypal_order(payload: PayPalCaptureRequest) -> dict[str, str]:
    async with httpx.AsyncClient(base_url=PAYPAL_API_BASE, timeout=httpx.Timeout(20.0, connect=5.0)) as client:
        token = await paypal_access_token(client)
        try:
            response = await client.post(
                f"/v2/checkout/orders/{payload.order_id}/capture",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "PayPal-Request-Id": f"wepay-capture-{payload.order_id}"},
                json={},
            )
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as exc:
            try:
                issue = exc.response.json().get("details", [{}])[0].get("issue", "")
            except (ValueError, IndexError, AttributeError):
                issue = ""
            if issue == "ORDER_ALREADY_CAPTURED":
                return {"orderId": payload.order_id, "status": "COMPLETED"}
            raise HTTPException(status_code=502, detail="PayPal could not capture the approved order. Reopen the checkout and retry.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="PayPal could not be reached to confirm this payment.") from exc
    if result.get("status") != "COMPLETED":
        raise HTTPException(status_code=409, detail="PayPal has not completed this payment yet.")
    async with ledger_manager._lock:
        row = ledger_manager.ledger.get(payload.order_id)
        if row:
            row["status"] = "Settled"
    await asyncio.gather(
        ledger_manager.publish({"type": "ledger.settled", "orderId": payload.order_id, "status": "Settled"}),
        ledger_manager.publish({"type": "collection.pinger", "ledgerId": payload.order_id, "message": "Payment received. The family ledger has been updated.", "members": []}),
    )
    return {"orderId": payload.order_id, "status": "COMPLETED"}
