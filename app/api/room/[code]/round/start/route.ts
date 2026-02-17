import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { pusherServer } from "@/lib/pusher-server";
import { QUESTION_BANK } from "@/lib/question-bank";

type Params = { code: string };

function makeId(len = 10) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export async function POST(_req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) return NextResponse.json({ error: "Room expirée" }, { status: 404 });

    const ttl = await redis.ttl(roomKey);
    const ttlSeconds = typeof ttl === "number" && ttl > 0 ? ttl : 60 * 60 * 2;

    const roundId = makeId();
    const item = QUESTION_BANK[Math.floor(Math.random() * QUESTION_BANK.length)];

    const sequenceStartAt = Date.now();

    // ⚠️ Durées estimées (simple). Amélioration plus tard: durée réelle via metadata.
    const questionDuration = 3000;
    const optionDuration = 3000;
    const gap = 3000; // pause entre chaque réponse

    // question + (gap + option) * 4
    const sequenceDuration = questionDuration + (gap + optionDuration) * 4;

    const answerStartAt = sequenceStartAt + sequenceDuration;
    const endsAt = answerStartAt + 10_000;

    const roundKey = `room:${code}:round:${roundId}`;

    await redis.set(
        roundKey,
        {
            roundId,
            difficulty: item.difficulty,
            questionUrl: item.questionUrl,
            optionUrls: item.optionUrls,
            correctIndex: item.correctIndex, // serveur only
            sequenceStartAt,
            answerStartAt,
            endsAt,
            createdAt: Date.now(),
        },
        { ex: ttlSeconds }
    );

    await redis.set(`room:${code}:currentRound`, { roundId }, { ex: ttlSeconds });

    const payload = {
        roundId,
        difficulty: item.difficulty,
        questionUrl: item.questionUrl,
        optionUrls: item.optionUrls,
        sequenceStartAt,
        answerStartAt,
        endsAt,
    };

    await pusherServer.trigger(`room-${code}`, "round-started", payload);

    return NextResponse.json(payload);
}