"""Check local links in a rendered Jekyll site without making network requests."""

import argparse
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

MAX_HTML_BYTES = 2 * 1024 * 1024
ATTRIBUTES = {"a": "href", "link": "href", "img": "src", "script": "src"}


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.duplicates = set()
        self.links = []
        self.has_base_href = False
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "base" and "href" in values:
            self.has_base_href = True
        identity = values.get("id")
        if identity is not None:
            if identity in self.ids:
                self.duplicates.add(identity)
            self.ids.add(identity)
        value = values.get(ATTRIBUTES.get(tag))
        if value is not None:
            self.links.append(value)


def normalized_base_url(value):
    if value == "":
        return ""
    if not value.startswith("/") or value.endswith("/"):
        raise ValueError("base URL must be empty or a leading-slash path without a trailing slash")
    if any(part in ("", ".", "..") for part in value[1:].split("/")):
        raise ValueError("base URL contains an invalid path component")
    if any(char in value for char in "?#%\\"):
        raise ValueError("base URL contains URL syntax rather than a canonical path")
    return value


def check_site(directory, base_url="/midnight-passport-sdk"):
    base_url = normalized_base_url(base_url)
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("rendered site must be a directory")
    pages, errors = {}, []
    paths = sorted(root.rglob("*.html"))
    if not paths:
        raise ValueError("rendered site has no HTML pages")
    for path in paths:
        source = path.relative_to(root).as_posix()
        target = path.resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file():
            errors.append({"source": source, "error": "HTML page escapes the site"})
            continue
        with target.open("rb") as page_file:
            content = page_file.read(MAX_HTML_BYTES + 1)
        if len(content) > MAX_HTML_BYTES:
            errors.append({"source": source, "error": "HTML page exceeds the byte bound"})
            continue
        parsed = Page(content.decode("utf-8"))
        pages[target] = parsed
        if parsed.has_base_href:
            errors.append({"source": source, "error": "base href directives are not supported"})
        for identity in sorted(parsed.duplicates):
            errors.append({"source": source, "fragment": identity, "error": "duplicate id"})
    local_count, external_count = 0, 0
    for source, page in pages.items():
        for href in page.links:
            record = {"source": source.relative_to(root).as_posix(), "href": href}
            try:
                url = urlsplit(href)
                if url.scheme or url.netloc:
                    external_count += 1
                    continue
                local_count += 1
                path = unquote(url.path)
                if "\\" in path or "\0" in path:
                    raise ValueError("unsupported local URL path")
                if path.startswith("/"):
                    if base_url and path != base_url and not path.startswith(base_url + "/"):
                        raise ValueError("absolute link omits the configured base URL")
                    target = root / path[len(base_url):].lstrip("/")
                else:
                    target = source.parent / path if path else source
                target = target.resolve()
                if not target.is_relative_to(root):
                    raise ValueError("local target escapes the site")
                if target.is_dir():
                    target = (target / "index.html").resolve()
                if not target.is_relative_to(root):
                    raise ValueError("local target escapes the site")
                if not target.is_file():
                    raise ValueError("missing local target")
                if target.suffix.lower() == ".html" and target not in pages:
                    raise ValueError("HTML target was not admitted")
                if url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
                    raise ValueError("missing local anchor")
            except (ValueError, OSError) as error:
                errors.append({**record, "error": str(error)})
    return {
        "schemaVersion": 1,
        "kind": "rendered-docs-local-links",
        "outcome": "failed" if errors else "passed",
        "baseUrl": base_url,
        "pages": len(pages),
        "localLinksAssetsAndAnchors": local_count,
        "externalLinksNotFetched": external_count,
        "checkedAttributes": ATTRIBUTES,
        "errors": errors,
        "scope": "Rendered local href/src targets and HTML ids; no external URL, CSS or deployment qualification",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--base-url", default="/midnight-passport-sdk")
    parser.add_argument("--output", type=Path, help="Optional fresh JSON receipt; existing files are refused")
    args = parser.parse_args()
    try:
        result = check_site(args.directory, args.base_url)
        encoded = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            # Do not silently overwrite a failed or passing evidence receipt.
            with args.output.open("x", encoding="utf-8") as output:
                output.write(encoded)
        print(encoded, end="")
        return 0 if result["outcome"] == "passed" else 1
    except (ValueError, OSError, UnicodeError) as error:
        parser.exit(2, f"rendered-docs: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
