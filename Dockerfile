FROM redis:7-alpine

# Создай папку для конфига
RUN mkdir -p /usr/local/etc/redis

# Пароль передаётся при сборке и в образ не зашивается:
#   docker build --build-arg REDIS_PASSWORD=... .
# Без аргумента сборка падает намеренно — образ без пароля выпускать нельзя
ARG REDIS_PASSWORD
RUN test -n "$REDIS_PASSWORD" || \
    (echo "Не задан --build-arg REDIS_PASSWORD" >&2; exit 1)

# Создай конфиг с нужными настройками
RUN echo "port 6379" > /usr/local/etc/redis/redis.conf && \
    echo "bind 0.0.0.0" >> /usr/local/etc/redis/redis.conf && \
    echo "protected-mode no" >> /usr/local/etc/redis/redis.conf && \
    echo "requirepass $REDIS_PASSWORD" >> /usr/local/etc/redis/redis.conf && \
    echo "masterauth $REDIS_PASSWORD" >> /usr/local/etc/redis/redis.conf && \
    echo "user default on >$REDIS_PASSWORD ~* +@all" >> /usr/local/etc/redis/redis.conf && \
    echo "appendonly yes" >> /usr/local/etc/redis/redis.conf && \
    echo "dir /data" >> /usr/local/etc/redis/redis.conf

# Укажи порт
EXPOSE 6379

# Запусти Redis с этим конфигом
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]