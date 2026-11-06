#!/usr/bin/env node
/**
 * Entry point of the `dsh-deeptutor-mcp` bin: the DeepTutor tools as an MCP
 * stdio server (Claude Code, Codex and other MCP clients).
 */
import { startStdioServer } from "./mcp.ts";

startStdioServer();
