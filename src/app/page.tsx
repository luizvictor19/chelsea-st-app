import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Chelsea St
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Plataforma em construção.
      </h1>
      <p className="text-muted">
        Ainda não há nada para ver aqui. O primeiro passo é confirmar que a
        gravação de voz funciona no seu aparelho.
      </p>
      <Link
        href="/spike/audio"
        className="bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold"
      >
        Testar gravação
      </Link>
    </main>
  );
}
