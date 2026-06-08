FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN addgroup -g 1001 -S nodejs \
  && adduser -S space -u 1001 -G nodejs \
  && chown -R space:nodejs /app

USER space

EXPOSE 3000

CMD ["npm", "start"]