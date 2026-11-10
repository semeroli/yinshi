#!/usr/bin/env node
/**
 * Cloudflare Pages 构建脚本：静态资源原样输出到 dist/
 * 服务端逻辑由 functions/ 下的 Pages Functions 承载，无需编译。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const count = fs.readdirSync(out).length;
console.log(`[build] 已输出 ${count} 个顶层条目到 dist/`);
