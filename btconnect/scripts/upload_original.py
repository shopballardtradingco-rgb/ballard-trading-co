"""Transfer unchanged originals using the runtime's configured curl connection.

Usage: python scripts/upload_original.py /absolute/path/to/original.jpeg --role front
Read the printed metadata, call begin_photo_upload, then supply its JSON response
on stdin. Ticket credentials never enter files, command arguments or output.
No retries or redirects; uncertain uploads need a fresh ticket for the same hash.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

UPLOAD_URL = "https://deployment.example.invalid/photos/upload"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file")
    parser.add_argument("--role", choices=["front", "back", "detail"], required=True)
    args = parser.parse_args()
    path = Path(args.file).resolve(strict=True)
    data = path.read_bytes()
    if not 0 < len(data) <= 12_000_000:
        raise ValueError("Original must be at most 12 MB")
    mime = "image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if data.startswith(b"\xff\xd8\xff") else None
    if not mime:
        raise ValueError("Use original JPEG/PNG bytes")
    checksum = hashlib.sha256(data).hexdigest()
    print(json.dumps({"sha256_hex": checksum, "size_bytes": len(data), "content_type": mime, "role": args.role}), flush=True)
    # PTYs need explicit echo suppression before receiving a single-use ticket.
    attrs = None
    if sys.stdin.isatty():
        import termios
        attrs = termios.tcgetattr(sys.stdin)
        hidden = termios.tcgetattr(sys.stdin)
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
    print("Ready for private upload ticket JSON on stdin.", flush=True)
    try:
        line = sys.stdin.readline(8192)
    finally:
        if attrs:
            termios.tcsetattr(sys.stdin, termios.TCSANOW, attrs)
    ticket = json.loads(line)
    token = ticket.get("upload_token", "")
    if ticket.get("upload_url") != UPLOAD_URL or not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", token):
        raise ValueError("Unexpected upload ticket")
    # Recheck after waiting for the ticket; no silently replaced local original.
    if path.read_bytes() != data:
        raise ValueError("Original file changed while waiting for upload authorization")
    config = 'header = "Authorization: Bearer ' + token + '"\n'
    result = subprocess.run([
        "curl", "--silent", "--show-error", "--max-time", "90", "--request", "POST",
        "--config", "-", "--header", "Content-Type: " + mime,
        "--data-binary", "@" + str(path), "--write-out", "\n%{http_code}", UPLOAD_URL,
    ], input=config, text=True, capture_output=True, timeout=100)
    if result.returncode:
        raise ValueError("Original transfer was interrupted; obtain a fresh ticket for the same original")
    body, status = result.stdout.rsplit("\n", 1)
    if status != "201":
        raise ValueError("Original upload rejected (HTTP " + status + "); inspect the original and request a fresh ticket")
    response = json.loads(body)
    photo = response.get("photo", {})
    if photo.get("sha256_hex") != checksum or photo.get("role") != args.role:
        raise ValueError("Upload response does not match the original")
    if not re.fullmatch(r"photos/[0-9a-f]{64}/" + checksum + r"\.(jpeg|png)", photo.get("object_key", "")):
        raise ValueError("Unexpected photo reference")
    print(json.dumps({"photo": photo, "size_bytes": len(data), "sha256_verified": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never include ticket input, headers, subprocess output or tracebacks.
        print(str(error) if isinstance(error, ValueError) else "Original upload did not complete", file=sys.stderr)
        sys.exit(1)
