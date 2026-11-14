install:
	npm ci

test:
	npm test

run:
	npm start

health:
	curl -i http://localhost:3000/health
