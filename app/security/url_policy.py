import ipaddress
import socket
from urllib.parse import urlsplit

ALLOWED_SCHEMES = {"http", "https"}
MAX_URL_LENGTH = 2048


class URLPolicyError(ValueError):
    """Raised when a URL is not allowed for browser extraction."""


def validate_url(url: str, *, allow_private: bool = False) -> str:
    """Validate an extraction URL and return it unchanged when safe."""
    if not isinstance(url, str) or not url.strip():
        raise URLPolicyError("URL must be a non-empty string.")

    url = url.strip()
    if len(url) > MAX_URL_LENGTH:
        raise URLPolicyError(f"URL exceeds the {MAX_URL_LENGTH}-character limit.")

    parsed = urlsplit(url)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise URLPolicyError("Only http and https URLs are allowed.")
    if not parsed.hostname:
        raise URLPolicyError("URL must include a hostname.")
    if parsed.username or parsed.password:
        raise URLPolicyError("URLs containing credentials are not allowed.")

    if allow_private:
        return url

    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    try:
        addresses = {
            info[4][0]
            for info in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        }
    except OSError as exc:
        raise URLPolicyError(f"Could not resolve URL hostname: {exc}") from exc

    if not addresses:
        raise URLPolicyError("URL hostname did not resolve to an address.")

    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise URLPolicyError(
                "Private, loopback, link-local, and reserved network addresses are blocked."
            )

    return url
