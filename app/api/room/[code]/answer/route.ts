import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { pusherServer } from "@/lib/pusher-server";

type Params = { code: string };

export async function POST(req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const body = (await req.json().catch(() => null)) as
        | null
        | { playerId?: string; roundId?: string; choiceIndex?: number };

    const playerId = (body?.playerId ?? "").trim();
    const roundId = (body?.roundId ?? "").trim();
    const choiceIndex = body?.choiceIndex;

    if (!playerId || !roundId || typeof choiceIndex !== "number") {
        return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    if (choiceIndex < 0 || choiceIndex > 3) {
        return NextResponse.json({ error: "Choix invalide" }, { status: 400 });
    }

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) return NextResponse.json({ error: "Room expirée" }, { status: 404 });

    const roundKey = `room:${code}:round:${roundId}`;
    const round = (await redis.get(roundKey)) as any;
    if (!round) return NextResponse.json({ error: "Manche introuvable" }, { status: 404 });

    const now = Date.now();

    if (now < round.answerStartAt) {
        return NextResponse.json({ error: "Trop tôt (attends la fin de l'écoute)" }, { status: 409 });
    }
    if (now > round.endsAt) {
        return NextResponse.json({ error: "Trop tard" }, { status: 409 });
    }

    const ttl = await redis.ttl(roomKey);
    const ttlSeconds = typeof ttl === "number" && ttl > 0 ? ttl : 60 * 60 * 2;

    const answerKey = `room:${code}:answer:${roundId}:${playerId}`;
    const ok = await redis.set(
        answerKey,
        { choiceIndex, answeredAt: now },
        { nx: true, ex: ttlSeconds }
    );

    if (!ok) {
        return NextResponse.json({ error: "Déjà répondu" }, { status: 409 });
    }

    await pusherServer.trigger(`room-${code}`, "player-answered", {
        playerId,
        roundId,
        choiceIndex,
        answeredAt: now,
    });

    return NextResponse.json({ ok: true });
}