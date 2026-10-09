# Stage 1: install PHP dependencies (Composer is not needed in the final image).
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-interaction --prefer-dist --optimize-autoloader

# Stage 2: small runtime image. The official PHP image already includes pdo_sqlite.
FROM php:8.4-cli-alpine
WORKDIR /app
COPY --from=vendor /app/vendor ./vendor
COPY composer.json ./
COPY src ./src
COPY public ./public
COPY bin ./bin

# Do not run as root.
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown app:app /app/data
USER app

ENV LEGACY_DB_PATH=/app/data/legacy.sqlite \
    PHP_CLI_SERVER_WORKERS=4
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD php -r "exit(@file_get_contents('http://127.0.0.1:8080/health') ? 0 : 1);"

# Create/seed the database, then serve with PHP's built-in server (4 workers; fine for a mock).
CMD ["sh", "-c", "php bin/init-db.php && exec php -S 0.0.0.0:8080 -t public"]
