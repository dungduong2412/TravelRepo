# TravelRepo
Repo for VB number one
# Backend Platform API

## Purpose
This repository contains the backend API responsible for all business logic.
It is designed to be:
- Explicit
- Auditable
- Replaceable
- Safe for team rotation

Frontend clients must never access the database directly.

## Tech Stack
- Node.js + TypeScript
- NestJS
- Prisma
- PostgreSQL (Supabase)
- Supabase Auth (JWT)
- Swagger (OpenAPI)

## Core Principles
- Controllers define contracts only
- Services contain business logic
- Policies enforce authorization
- Database access is centralized
- No hidden logic in database triggers or RPCs

## Local Development
1. Copy `.env.example` to `.env`
2. Install dependencies
3. Run migrations
4. Start the API

## Ownership
All logic in this repository must be understandable by any senior engineer within 1 hour.
