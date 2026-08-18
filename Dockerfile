# Serve the prebuilt static application with Nginx.
# Build it first with `npm run build`.
FROM nginx:1.27-alpine

ARG API_UPSTREAM=api
COPY nginx.conf /tmp/default.conf
RUN sed "s/__API_UPSTREAM__/${API_UPSTREAM}/g" /tmp/default.conf > /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
