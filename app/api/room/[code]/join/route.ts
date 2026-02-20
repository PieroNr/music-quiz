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

// Petit garde-fou: avatar data URL pas trop gros
function isValidAvatarDataUrl(s: unknown) {
    if (typeof s !== "string") return false;
    if (!s.startsWith("data:image/")) return false;
    // limite “safe” (vignette). Ajuste si besoin.
    return s.length <= 120_000;
}

export async function POST(req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const body = (await req.json().catch(() => null)) as
        | null
        | { name?: string; avatarDataUrl?: string | null };

    const name = (body?.name ?? "").trim().slice(0, 24);
    const avatarDataUrl = body?.avatarDataUrl ?? null;

    if (!name) {
        return NextResponse.json({ error: "Pseudo requis" }, { status: 400 });
    }

    if (avatarDataUrl !== null && !isValidAvatarDataUrl(avatarDataUrl)) {
        return NextResponse.json({ error: "Avatar invalide ou trop lourd" }, { status: 400 });
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

    const playerObj = {
        id: playerId,
        name,
        avatarDataUrl: avatarDataUrl ?? null,
        joinedAt: Date.now(),
    };

    await redis.set(playerKey, playerObj, { ex: ttlSeconds });
    await redis.sadd(playersSetKey, playerId);
    await redis.expire(playersSetKey, ttlSeconds);

    await pusherServer.trigger(`room-${code}`, "player-joined", {
        id: playerObj.id,
        name: playerObj.name,
        joinedAt: playerObj.joinedAt,
    });

    return NextResponse.json({ playerId, name, code });
}