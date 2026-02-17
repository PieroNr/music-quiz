"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HostPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function createRoom() {
        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/room/create", { method: "POST" });
            if (!res.ok) throw new Error("Impossible de créer la partie");
            const data = (await res.json()) as { code: string };

            router.push(`/host/${data.code}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Erreur inconnue");
            setLoading(false);
        }
    }

    return (
        <main className="min-h-screen p-6">
            <h1 className="text-2xl font-bold">Host</h1>
            <p className="mt-2 text-gray-600">
                Crée une partie et partage le code aux joueurs.
            </p>

            <button
                onClick={createRoom}
                disabled={loading}
                className="mt-6 rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
            >
                {loading ? "Création..." : "Créer une partie"}
            </button>

            {error && <p className="mt-4 text-red-600">{error}</p>}
        </main>
    );
}