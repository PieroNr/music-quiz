import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { pusherServer } from "@/lib/pusher-server";

type Params = { code: string };

function makeId(len = 12) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export async function POST(req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const body = (await req.json().catch(() => null)) as null | { name?: string };
    const name = (body?.name ?? "").trim().slice(0, 24);

    if (!name) {
        return NextResponse.json({ error: "Pseudo requis" }, { status: 400 });
    }

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) {
        return NextResponse.json({ error: "Room introuvable ou expirée" }, { status: 404 });
    }

    const playerId = makeId();
    const playerKey = `room:${code}:player:${playerId}`;
    const playersSetKey = `room:${code}:players`;

    const ttl = await redis.ttl(roomKey);
    const ttlSeconds = typeof ttl === "number" && ttl > 0 ? ttl : 60 * 60 * 2;

    await redis.set(playerKey, { id: playerId, name, joinedAt: Date.now() }, { ex: ttlSeconds });
    await redis.sadd(playersSetKey, playerId);
    await redis.expire(playersSetKey, ttlSeconds);

    await pusherServer.trigger(`room-${code}`, "player-joined", {
        id: playerId,
        name,
        joinedAt: Date.now(),
    });

    return NextResponse.json({ playerId, name, code });
}