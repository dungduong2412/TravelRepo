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
- Supabase JS Client
- PostgreSQL (Supabase)
- Supabase Auth (JWT)
- Zod (validation)

## Core Principles
- Controllers define contracts only
- Services contain business logic
- Database access via Supabase client
- No hidden logic in database triggers or RPCs

## Local Development
1. Copy `.env.example` to `.env`
2. Configure Supabase credentials
3. Install dependencies in `backend/` directory
4. Start the API on port 3000

## Ownership
All logic in this repository must be understandable by any senior engineer within 1 hour.
