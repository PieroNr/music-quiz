import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type Params = { code: string };

export async function GET(_req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) {
        return NextResponse.json({ error: "Room introuvable ou expirée" }, { status: 404 });
    }

    const playersSetKey = `room:${code}:players`;
    const ids = (await redis.smembers(playersSetKey)) as string[];

    if (!ids.length) return NextResponse.json({ players: [] });

    const keys = ids.map((id) => `room:${code}:player:${id}`);
    const playersRaw = await redis.mget(...keys);

    const players = (playersRaw ?? [])
        .filter(Boolean)
        .map((p: any) => ({ id: p.id as string, name: p.name as string, joinedAt: p.joinedAt as number }))
        .sort((a, b) => a.joinedAt - b.joinedAt);

    return NextResponse.json({ players });
}