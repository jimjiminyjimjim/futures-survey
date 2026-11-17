import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { getSignedInUser } from "@/lib/auth/session";
import { getPresentationData } from "@/lib/presentation/get-presentation-data";
import { buildSlides } from "@/lib/presentation/build-slides";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { PresentationDeck } from "@/components/presentation/presentation-deck";

// This route reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents.
// `instant = false` only opts this segment out of Instant Navigation
// (prefetch). See src/app/admin/page.tsx for the full explanation of why
// `connection()` is also needed below (speculative shell-prerender hits an
// unguarded Date.now() inside the Supabase client chain otherwise).
export const instant = false;

const RoundIdSchema = z.uuid();

export default async function PresentRoundPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  await connection();

  const { roundId } = await params;
  const parsedRoundId = RoundIdSchema.safeParse(roundId);
  if (!parsedRoundId.success) {
    notFound();
  }

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const result = await getPresentationData(parsedRoundId.data);

  if (!result.ok && result.reason === "not_found") {
    notFound();
  }

  if (!result.ok) {
    return (
      <div className="dark fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-pres-page px-16 text-pres-ink">
        {result.isUnopenedDraft ? (
          <p
            data-slot="deck-notice"
            className="rounded-md bg-amber-300 px-3 py-1.5 text-[17px] leading-tight font-semibold text-black"
          >
            {PRESENTATION_MESSAGES.testAnswersLabel}
          </p>
        ) : null}
        <p role="alert" className="text-[28px] font-normal">
          {PRESENTATION_MESSAGES.loadFailed}
        </p>
      </div>
    );
  }

  const { slides } = buildSlides(result.input);

  // Quick task 261117-it4: an unopened draft's answers are all admin test
  // answers, so the deck labels every slide.
  return (
    <PresentationDeck
      slides={slides}
      notice={
        result.isUnopenedDraft ? PRESENTATION_MESSAGES.testAnswersLabel : null
      }
    />
  );
}
