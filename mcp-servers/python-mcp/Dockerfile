FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc build-essential python3-dev && \
    rm -rf /var/lib/apt/lists/*

RUN pip install -U pip setuptools wheel

ENV BLIS_ARCH=generic
RUN pip install --no-cache-dir --no-binary=blis blis

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create output directory
RUN mkdir /app/output

# Set matplotlib to non-interactive mode
ENV MPLBACKEND=Agg

CMD ["python"]