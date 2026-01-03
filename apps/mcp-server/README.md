# @medi/mcp-server

Model Context Protocol (MCP) server for the Medi Platform.

## What it does
Exposes MCP tools that call the existing Medi Fastify API:
- `medi.health`
- `medi.upload_prescription`
- `medi.get_prescription`
- `medi.extract_prescription`
- `medi.confirm_prescription`
- `medi.place_cod_order`
- `medi.get_vendor_orders`

## Run
1) Start the API (in another terminal):
- `npm run -w @medi/api dev`

2) Start the MCP server (stdio transport):
- `npm run -w @medi/mcp-server dev`

## Configuration
- `MEDI_API_BASE_URL` (default `http://127.0.0.1:4000`)

Example:
- `MEDI_API_BASE_URL=http://127.0.0.1:4000`

## Notes
- This MCP server is intentionally thin: it delegates business logic to the Fastify API.
- Keys (Firestore/OCR/LLM/Calendar) are still configured in the API environment.
