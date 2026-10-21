from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import os
from urllib.parse import urlsplit
from cryptography.fernet import Fernet

SCOPE = "btco:read"
WRITE_SCOPE = "btco:listings"
INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory"
ACCOUNT_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.account.readonly"
MARKETING_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.marketing"
LISTING_EBAY_SCOPES = [INVENTORY_SCOPE, ACCOUNT_SCOPE, MARKETING_SCOPE]
LEGACY_EBAY_SCOPES = [
    "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
]
TRADING_SCOPE = "https://api.ebay.com/oauth/api_scope"
EBAY_SCOPES = [TRADING_SCOPE, *LEGACY_EBAY_SCOPES]


@dataclass(frozen=True)
class Settings:
    public_url: str
    client_id: str
    client_secret: str
    runame: str
    encryption_key: str
    db_path: str = "/data/btco.sqlite3"
    allowed_seller: str = "ballardtradingco"
    port: int = 8000
    publication_enabled: bool = False
    openai_api_key: str = field(default="", repr=False)
    ai_budget_micros: int = 0
    core_callback_url: str = ""

    def __post_init__(self):
        u = urlsplit(self.public_url)
        if (u.scheme != "https" or not u.hostname or u.username or u.password
                or u.path not in ("", "/") or u.query or u.fragment):
            raise ValueError("PUBLIC_URL must be the connector's HTTPS origin, without a path.")
        if not all([self.client_id, self.client_secret, self.runame, self.allowed_seller]):
            raise ValueError("eBay credentials, RuName and allowed seller must be configured.")
        if self.core_callback_url:
            callback = urlsplit(self.core_callback_url)
            if callback.scheme != "https" or not callback.hostname or callback.username or callback.password or callback.query or callback.fragment or callback.path != "/api/ebay/callback":
                raise ValueError("BTCORE_CALLBACK_URL must be the exact HTTPS Core callback")
        Fernet(self.encryption_key.encode())
        if type(self.ai_budget_micros) is not int or not 0 <= self.ai_budget_micros <= 5_000_000:
            raise ValueError("BTCO_AI_BUDGET_USD must be between zero and five USD for the pilot")

    @property
    def origin(self):
        return self.public_url.rstrip("/")

    @property
    def resource(self):
        return self.origin + "/mcp"

    @classmethod
    def from_env(cls):
        names = ["PUBLIC_URL", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME", "TOKEN_ENCRYPTION_KEY"]
        missing = [n for n in names if not os.environ.get(n)]
        if missing:
            raise ValueError("Missing configuration: " + ", ".join(missing))
        try:
            budget = Decimal(os.environ.get("BTCO_AI_BUDGET_USD", "0")) * 1_000_000
            if not budget.is_finite() or budget != budget.to_integral_value():
                raise ValueError("Invalid AI budget")
        except (InvalidOperation, ValueError):
            raise ValueError("BTCO_AI_BUDGET_USD must be a finite USD amount") from None
        return cls(*(os.environ[n] for n in names),
                   core_callback_url=os.environ.get("BTCORE_CALLBACK_URL", ""),
                   db_path=os.environ.get("BTCO_DB_PATH", "/data/btco.sqlite3"),
                   allowed_seller=os.environ.get("EBAY_ALLOWED_SELLER", "ballardtradingco"),
                   port=int(os.environ.get("PORT", "8000")),
                   publication_enabled=os.environ.get("BTCO_PUBLICATION_ENABLED") == "true",
                   openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
                   ai_budget_micros=int(budget))



