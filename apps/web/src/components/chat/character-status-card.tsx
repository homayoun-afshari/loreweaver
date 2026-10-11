import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CharacterState, LegacyError } from "@/lib/legacy";
import {
  describeLegacyError,
  formatUpdatedAt,
  locationLabel,
  statPercent,
} from "./character-card-model";

/** A labeled horizontal bar (used for mana and health). */
function StatBar({ label, value, barClass }: { label: string; value: number; barClass: string }) {
  const percent = statPercent(value);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** The loaded state: what the legacy CMS says about one character right now. */
export function CharacterStatusCard({ character }: { character: CharacterState }) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{character.name}</span>
          <Badge variant={character.condition === "wounded" ? "destructive" : "secondary"}>
            {character.condition}
          </Badge>
        </CardTitle>
        <CardDescription>{locationLabel(character.location)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatBar label="Mana" value={character.mana} barClass="bg-blue-500" />
        <StatBar label="Health" value={character.hp} barClass="bg-emerald-500" />
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Inventory</p>
          {character.inventory.length === 0 ? (
            <p className="text-sm">Carrying nothing.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {character.inventory.map((item, index) => (
                <li key={`${item}-${index}`}>
                  <Badge variant="outline">{item}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Updated {formatUpdatedAt(character.updatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

/** The loading state: the same layout as the card, drawn in gray, shown while the tool runs. */
export function CharacterStatusCardSkeleton() {
  return (
    <Card className="w-full max-w-sm" role="status" aria-label="Loading character state">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

/** The failure state: the chat keeps working, only this card says it could not load. */
export function CharacterStatusCardError({ error }: { error?: LegacyError }) {
  const { title, detail } = error
    ? describeLegacyError(error)
    : { title: "Could not load character state", detail: "Please try again later." };
  return (
    <Card className="w-full max-w-sm border-destructive/40" role="alert">
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}
