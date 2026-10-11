import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LoreHit } from "@/lib/rag/search-types";
import {
  describeSearchError,
  docTypeLabel,
  fileName,
  snippet,
  sourcesSummary,
} from "./lore-citation-model";

/**
 * One cited passage. A native <details> element does the collapsing: it is keyboard accessible
 * and needs no state. Collapsed: heading, file and a snippet. Open: the whole passage.
 */
function LoreCitationCard({ hit }: { hit: LoreHit }) {
  return (
    <details className="group rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium">{hit.headingPath || fileName(hit.sourcePath)}</span>
            {/* The same id the answer cites, so the reader can match [id] to its card. */}
            <Badge variant="secondary" className="shrink-0 font-mono">
              {hit.citationId}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {fileName(hit.sourcePath)} · {docTypeLabel(hit.docType)}
          </p>
          <p className="text-muted-foreground group-open:hidden">{snippet(hit.content)}</p>
        </div>
      </summary>
      <div className="border-t px-3 py-2 whitespace-pre-wrap">{hit.content}</div>
    </details>
  );
}

/** The loaded state: the passages the lore search found, as collapsible cards. */
export function LoreCitationCards({ hits }: { hits: LoreHit[] }) {
  if (hits.length === 0) {
    return (
      <Card size="sm" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>No matching lore</CardTitle>
          <CardDescription>Your lore has nothing that matches this question.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <section aria-label="Lore sources" className="w-full max-w-md space-y-2">
      <p className="text-xs text-muted-foreground">{sourcesSummary(hits.length)}</p>
      <ul className="space-y-2">
        {hits.map((hit) => (
          <li key={hit.citationId}>
            <LoreCitationCard hit={hit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The loading state: the same shape as one card, drawn in gray, shown while the search runs. */
export function LoreCitationCardsSkeleton() {
  return (
    <Card size="sm" className="w-full max-w-md" role="status" aria-label="Searching your lore">
      <CardHeader>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-32" />
      </CardHeader>
    </Card>
  );
}

/** The failure state: the chat keeps working, only this card says the search did not run. */
export function LoreCitationCardsError() {
  const { title, detail } = describeSearchError();
  return (
    <Card size="sm" className="w-full max-w-md border-destructive/40" role="alert">
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}
