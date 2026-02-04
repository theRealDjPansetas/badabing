FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./server.js
COPY problems ./problems
COPY c ./c

RUN mkdir -p /app/bin && \
    gcc -O2 -Wall -Wextra -std=c11 /app/c/regex2mindfa_compiler.c -o /app/bin/regex2mindfa && \
    gcc -O2 -Wall -Wextra -std=c11 /app/c/dfa_checker.c -o /app/bin/dfa_checker && \
    gcc -O2 -Wall -Wextra -std=c11 /app/c/dfa2table.c -o /app/bin/dfa2table

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
