ARG CHROME_IMAGE
FROM ${CHROME_IMAGE}
USER root
RUN mv /usr/bin/websockify /usr/bin/websockify-real
COPY delayed-websockify /usr/bin/websockify
RUN sed -i 's/\r$//' /usr/bin/websockify && chmod 755 /usr/bin/websockify
USER 10001:10001
