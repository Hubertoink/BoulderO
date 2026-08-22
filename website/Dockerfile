FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html 404.html robots.txt sitemap.xml styles.css /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY impressum /usr/share/nginx/html/impressum
COPY datenschutz /usr/share/nginx/html/datenschutz

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
