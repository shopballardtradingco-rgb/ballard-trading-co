"""OAuth bridge: ChatGPT PKCE -> connector -> eBay seller consent.

The SDK validates redirect URIs, client credentials and PKCE. This provider binds
each credential to one resource, client and verified seller, persists grants,
and atomically consumes codes/refresh tokens. eBay tokens never reach ChatGPT.
"""
import hmac
import re
import secrets
import time
from urllib.parse import urlencode, urlsplit
from mcp.server.auth.provider import (AccessToken, AuthorizationCode, AuthorizationParams,
    AuthorizeError, OAuthAuthorizationServerProvider, RefreshToken, RegistrationError,
    TokenError, construct_redirect_uri)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from .config import SCOPE, WRITE_SCOPE, EBAY_SCOPES, LISTING_EBAY_SCOPES
from .store import digest


def allowed_callback(uri):
    u = urlsplit(str(uri))
    return (u.scheme == "https" and u.netloc == "chatgpt.com" and not u.query and not u.fragment
            and (u.path == "/connector_platform_oauth_redirect" or
                 re.fullmatch(r"/connector/oauth/[A-Za-z0-9_-]+", u.path) is not None))


class Code(AuthorizationCode):
    family: str


class Refresh(RefreshToken):
    family: str


class Access(AccessToken):
    family: str


class ConsentClient(OAuthClientInformationFull):
    def validate_scope(self, requested_scope):
        # Dynamic ChatGPT clients may request the newly supported optional scope
        # through a NEW interactive authorization. This grants nothing by itself:
        # consent/PKCE/code exchange still run, and refresh is bounded by old scopes.
        if requested_scope and set(requested_scope.split()) <= {SCOPE, WRITE_SCOPE}:
            return requested_scope.split()
        return super().validate_scope(requested_scope)


class Provider(OAuthAuthorizationServerProvider[Code, Refresh, Access]):
    def __init__(self, settings, store, ebay):
        self.settings, self.store, self.ebay = settings, store, ebay

    def callback_allowed(self, uri):
        return allowed_callback(uri) or bool(self.settings.core_callback_url and str(uri) == self.settings.core_callback_url)

    async def get_client(self, client_id):
        data = self.store.get("client", client_id)
        return ConsentClient.model_validate(data) if data else None

    async def register_client(self, client_info):
        if not client_info.redirect_uris or not all(self.callback_allowed(u) for u in client_info.redirect_uris):
            raise RegistrationError("invalid_redirect_uri", "Only ChatGPT OAuth callbacks are supported.")
        if client_info.token_endpoint_auth_method not in ("none", "client_secret_post", "client_secret_basic"):
            raise RegistrationError("invalid_client_metadata", "Unsupported token authentication method.")
        with self.store.tx() as db:
            if db.execute("SELECT count(*) FROM records WHERE kind='client'").fetchone()[0] >= 1000:
                raise RegistrationError("invalid_client_metadata", "Registration capacity reached; contact the owner.")
            self.store.put("client", client_info.client_id, client_info.model_dump(mode="json"), db=db)

    async def authorize(self, client, params):
        if params.resource != self.settings.resource:
            raise AuthorizeError("invalid_request", "The requested resource must match this connector.")
        if SCOPE not in (params.scopes or [SCOPE]) or not set(params.scopes or [SCOPE]) <= {SCOPE, WRITE_SCOPE}:
            raise AuthorizeError("invalid_scope", "Request btco:read and optionally btco:listings.")
        if not self.callback_allowed(params.redirect_uri):
            raise AuthorizeError("invalid_request", "Unrecognized ChatGPT callback.")
        flow = secrets.token_urlsafe(32)
        self.store.put("flow", flow, {"client_id": client.client_id, "params": params.model_dump(mode="json")}, time.time() + 600)
        return self.settings.origin + "/consent?" + urlencode({"flow": flow})

    def start_browser(self, flow):
        with self.store.tx() as db:
            data = self.store.get("flow", flow, db=db)
            if not data:
                raise ValueError("This connection request has expired. Start again from ChatGPT.")
            nonce = secrets.token_urlsafe(32)
            data["browser"] = digest(nonce)
            data["stage"] = "consent"
            self.store.put("flow", flow, data, time.time() + 600, db=db)
            return nonce

    def accept_browser(self, flow, nonce):
        with self.store.tx() as db:
            data = self.store.get("flow", flow, db=db)
            if (not data or data.get("stage") != "consent" or not nonce or
                    not hmac.compare_digest(data.get("browser", ""), digest(nonce))):
                raise ValueError("Invalid connection request. Start again from ChatGPT.")
            data["stage"] = "ebay"
            self.store.put("flow", flow, data, time.time() + 600, db=db)
        return "https://auth.ebay.com/oauth2/authorize?" + urlencode({
            "client_id": self.settings.client_id, "redirect_uri": self.settings.runame,
            "response_type": "code", "scope": " ".join(EBAY_SCOPES + (LISTING_EBAY_SCOPES if WRITE_SCOPE in data["params"].get("scopes", []) else [])), "state": flow,
            "prompt": "login"})

    async def callback(self, flow, nonce, upstream_code, denied=False):
        with self.store.tx() as db:
            data = self.store.get("flow", flow, db=db)
            if (not data or data.get("stage") != "ebay" or not nonce or
                    not hmac.compare_digest(data.get("browser", ""), digest(nonce))):
                raise ValueError("Invalid or expired eBay callback. Start again from ChatGPT.")
            self.store.get("flow", flow, consume=True, db=db)
        params = AuthorizationParams.model_validate(data["params"])
        if denied or not upstream_code:
            return construct_redirect_uri(str(params.redirect_uri), error="access_denied", state=params.state)
        requested = EBAY_SCOPES + (LISTING_EBAY_SCOPES if WRITE_SCOPE in (params.scopes or []) else [])
        grant = await self.ebay.exchange(upstream_code, requested_scopes=requested)
        family, code = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        auth_code = Code(code=code, scopes=params.scopes or [SCOPE], expires_at=time.time()+120,
            client_id=data["client_id"], code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri, redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=self.settings.resource, subject=grant["user_id"], family=family)
        # An unredeemed OAuth code must not leave a long-lived upstream token behind.
        with self.store.tx() as db:
            self.store.put("grant", family, grant, time.time()+180, family, db)
            self.store.put("code", code, auth_code.model_dump(mode="json", exclude={"code"}), auth_code.expires_at, family, db)
        return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)

    async def load_authorization_code(self, client, authorization_code):
        data = self.store.get("code", authorization_code)
        if not data or data["client_id"] != client.client_id:
            return None
        return Code(code=authorization_code, **data)

    def mint(self, client_id, family, subject, scopes, db):
        grant = self.store.get("grant", family, db=db)
        if not grant or grant["refresh_expires_at"] <= time.time():
            raise TokenError("invalid_grant", "Seller authorization has expired.")
        access, refresh = secrets.token_urlsafe(40), secrets.token_urlsafe(48)
        expires = int(time.time()) + 3600
        refresh_expiry = min(int(time.time())+30*86400, int(grant["refresh_expires_at"]))
        grant["connection_expires_at"] = refresh_expiry
        common = {"client_id": client_id, "family": family, "subject": subject, "scopes": scopes, "resource": self.settings.resource}
        self.store.put("grant", family, grant, refresh_expiry, family, db)
        self.store.put("access", access, {**common, "expires_at": expires}, expires, family, db)
        self.store.put("refresh", refresh, {**common, "expires_at": refresh_expiry}, refresh_expiry, family, db)
        return OAuthToken(access_token=access, token_type="Bearer", expires_in=3600, refresh_token=refresh, scope=" ".join(scopes))

    async def exchange_authorization_code(self, client, authorization_code):
        with self.store.tx() as db:
            data = self.store.get("code", authorization_code.code, consume=True, db=db)
            if not data or data["client_id"] != client.client_id or data["resource"] != self.settings.resource:
                raise TokenError("invalid_grant", "Authorization code is invalid or already used.")
            return self.mint(client.client_id, data["family"], data["subject"], data["scopes"], db)

    async def load_refresh_token(self, client, refresh_token):
        data = self.store.get("refresh", refresh_token)
        if not data or data["client_id"] != client.client_id:
            return None
        return Refresh(token=refresh_token, **data)

    async def exchange_refresh_token(self, client, refresh_token, scopes):
        with self.store.tx() as db:
            data = self.store.get("refresh", refresh_token.token, consume=True, db=db)
            if not data or data["client_id"] != client.client_id or data["resource"] != self.settings.resource:
                raise TokenError("invalid_grant", "Refresh token is invalid or already used.")
            if SCOPE not in scopes or not set(scopes) <= set(data["scopes"]):
                raise TokenError("invalid_scope", "Refresh cannot add listing permissions.")
            # Rotate the whole pair. Revocation remains attached to the same family.
            db.execute("DELETE FROM records WHERE kind='access' AND family=?", (data["family"],))
            return self.mint(client.client_id, data["family"], data["subject"], scopes, db)

    async def load_access_token(self, token):
        data = self.store.get("access", token)
        if (not data or data["resource"] != self.settings.resource or SCOPE not in data["scopes"]
                or not self.store.get("grant", data["family"])):
            return None
        return Access(token=token, **data)

    async def revoke_token(self, token):
        self.store.delete_family(token.family)


