import pytest

from app.security.url_policy import URLPolicyError, validate_url
from app.services.extraction import extract_page


def test_public_https_url_is_allowed():
    assert validate_url("https://93.184.216.34/product") == "https://93.184.216.34/product"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:5000/lab/attack-page",
        "http://localhost:5000/lab/attack-page",
        "http://192.168.1.10/product",
        "ftp://example.com/file",
        "file:///etc/passwd",
        "https://user:password@example.com/product",
        "",
    ],
)
def test_unsafe_urls_are_rejected(url):
    with pytest.raises(URLPolicyError):
        validate_url(url)


def test_allow_private_is_explicit_for_local_lab_page():
    url = "http://127.0.0.1:5000/lab/attack-page"
    assert validate_url(url, allow_private=True) == url


def test_extraction_blocks_private_url_before_launching_browser():
    result = extract_page("http://127.0.0.1:5000/lab/attack-page")

    assert result.success is False
    assert "URL policy violation" in result.error
