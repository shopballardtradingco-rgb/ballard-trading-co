FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY pyproject.toml ./
COPY btco_ebay ./btco_ebay
RUN pip install --no-cache-dir --no-deps . && mkdir -p /data && chmod 700 /data
# Railway mounts its volume at runtime. The default root UID can write to it.
# Keep a single worker and a single replica for this SQLite-backed private service.
EXPOSE 8000
CMD ["btco-ebay"]
