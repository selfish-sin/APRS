import { Link } from "@/lib/router";

export function NotFound({ what = "这一页" }: { what?: string }) {
  return (
    <section className="card" aria-label="找不到">
      <h1 className="t-section-24">{what}找不到了</h1>
      <p className="muted">可能是链接不对，或者已经删掉了。</p>
      <div className="form-actions">
        <Link to="/hall" className="ui-button" data-style="Accent" data-size="Medium">
          回大厅
        </Link>
      </div>
    </section>
  );
}
