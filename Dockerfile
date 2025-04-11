FROM public.ecr.aws/lambda/nodejs:20

RUN echo "--- Installing system dependencies ---" && \
    dnf install -y nss mesa-libgbm alsa-lib atk cairo cups libXcomposite libXcursor \
                   libXdamage libXext libXfixes libXi libXrandr libXtst pango \
                   liberation-fonts \
    && dnf clean all \
    && echo "--- System dependencies installed ---"

WORKDIR /var/task

COPY package.json package-lock.json ./

RUN npm install --production

COPY index.js ./

CMD [ "index.handler" ]