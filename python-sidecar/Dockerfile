FROM --platform=linux/amd64 python:3.12-slim

# Which CAD library to install — set via --build-arg CAD_LIB=cadquery|build123d.
# CadQuery 2.5.x and Build123d 0.10.x pin to incompatible cadquery-ocp ranges
# (7.7 vs 7.8), so they cannot share a single image.
ARG CAD_LIB=cadquery

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglu1-mesa libxrender1 libsm6 libxext6 \
 && rm -rf /var/lib/apt/lists/*

COPY ${CAD_LIB}.txt /opt/requirements.txt
RUN pip install --no-cache-dir -r /opt/requirements.txt

COPY worker.py /opt/worker.py

WORKDIR /work
ENTRYPOINT ["python", "/opt/worker.py"]
