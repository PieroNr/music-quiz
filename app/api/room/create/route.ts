import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

function makeCode(len = 4) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export async function POST() {
    for (let attempt = 0; attempt < 10; attempt++) {
        const code = makeCode(4);
        const key = `room:${code}`;

        const ok = await redis.set(key, { createdAt: Date.now() }, { nx: true, ex: 60 * 60 * 2 });
        if (ok) return NextResponse.json({ code });
    }

    return NextResponse.json({ error: "Could not create room" }, { status: 500 });
}