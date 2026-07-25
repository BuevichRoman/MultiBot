FROM redis:7-alpine

# Создай папку для конфига
RUN mkdir -p /usr/local/etc/redis

# Создай конфиг с нужными настройками
RUN echo "port 6379" > /usr/local/etc/redis/redis.conf && \
    echo "bind 0.0.0.0" >> /usr/local/etc/redis/redis.conf && \
    echo "protected-mode no" >> /usr/local/etc/redis/redis.conf && \
    echo "requirepass REDACTED-REDIS-PASSWORD" >> /usr/local/etc/redis/redis.conf && \
    echo "masterauth REDACTED-REDIS-PASSWORD" >> /usr/local/etc/redis/redis.conf && \
    echo "user default on >REDACTED-REDIS-PASSWORD ~* +@all" >> /usr/local/etc/redis/redis.conf && \
    echo "appendonly yes" >> /usr/local/etc/redis/redis.conf && \
    echo "dir /data" >> /usr/local/etc/redis/redis.conf

# Укажи порт
EXPOSE 6379

# Запусти Redis с этим конфигом
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]