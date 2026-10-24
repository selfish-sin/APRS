import { useI18n } from "@/i18n/I18n";
import { Link } from "@/lib/router";

export type NotFoundWhat = "page" | "project" | "cut" | "member" | "doc";

export function NotFound({ what = "page" }: { what?: NotFoundWhat }) {
  const { L } = useI18n();
  return (
    <section className="card" aria-label={L.common.notFound}>
      <h1 className="t-section-24">{L.common.notFoundWhat[what]}</h1>
      <p className="muted">{L.common.notFoundLead}</p>
      <div className="form-actions">
        <Link to="/hall" className="ui-button" data-style="Accent" data-size="Medium">
          {L.common.backToHall}
        </Link>
      </div>
    </section>
  );
}
