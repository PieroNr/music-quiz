import Link from "next/link";

export default function Home() {
  return (
      <main className="min-h-screen p-6">
        <h1 className="text-3xl font-bold">Music Quiz</h1>
        <div className="mt-6 flex gap-3">
          <Link className="rounded-md bg-black px-4 py-2 text-white" href="/host">
            Aller sur Host
          </Link>
          <Link className="rounded-md border px-4 py-2" href="/join/TEST">
            Simuler un joueur
          </Link>
        </div>
      </main>
  );
}