import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api/client.ts';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function PromoteForm({ sourceId, programs, onDone }: { sourceId: number; programs: string[]; onDone: () => void }) {
  const [program, setProgram] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.adminPromoteSource(sourceId, program),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adminOverview'] });
      onDone();
    },
  });

  return (
    <form
      className="admin-promote-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (program.trim()) mutation.mutate();
      }}
    >
      <input
        list="admin-programs"
        value={program}
        onChange={(e) => setProgram(e.target.value)}
        placeholder="Program name"
        autoFocus
      />
      <datalist id="admin-programs">
        {programs.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <button className="btn btn-primary" type="submit" disabled={!program.trim() || mutation.isPending}>
        Confirm
      </button>
      <button className="btn" type="button" onClick={onDone}>
        Cancel
      </button>
      {mutation.isError && <span className="error-text">{(mutation.error as Error).message}</span>}
    </form>
  );
}

export function AdminDashboard() {
  const [promoting, setPromoting] = useState<number | null>(null);
  const [checkErrors, setCheckErrors] = useState<Record<number, string>>({});
  const qc = useQueryClient();

  const meQuery = useQuery({ queryKey: ['adminMe'], queryFn: api.me, retry: false });

  const overviewQuery = useQuery({
    queryKey: ['adminOverview'],
    queryFn: api.adminOverview,
    enabled: meQuery.data?.isAdmin === true,
    retry: false,
  });

  const checkMutation = useMutation({
    mutationFn: (sourceId: number) => api.adminCheckSource(sourceId),
    onSuccess: (result, sourceId) => {
      setCheckErrors((prev) => {
        const next: Record<number, string> = {};
        for (const [id, message] of Object.entries(prev)) {
          if (Number(id) !== sourceId) next[Number(id)] = message;
        }
        if (!result.ok) next[sourceId] = result.error;
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['adminOverview'] });
    },
  });

  async function logout() {
    await api.logout();
    window.location.href = '/';
  }

  if (meQuery.isLoading) return <div className="empty-state">Loading...</div>;

  if (!meQuery.data) {
    return (
      <div className="empty-state">
        Not logged in. <a href="/api/auth/google">Log in with Google</a> then come back to /admin.
      </div>
    );
  }

  if (!meQuery.data.isAdmin) {
    return <div className="empty-state">Not authorized. This account is not an admin.</div>;
  }

  const overview = overviewQuery.data;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <span className="app-brand">Admin</span>
        <a className="btn" href="/">
          Back to app
        </a>
        <button className="btn" onClick={() => void logout()}>
          Log out
        </button>
      </div>

      {overviewQuery.isLoading && <p className="hint">Loading stats...</p>}
      {overviewQuery.isError && <p className="error-text">{(overviewQuery.error as Error).message}</p>}

      {overview && (
        <>
          <div className="admin-grid">
            <div className="admin-card">
              <div className="admin-card-value">{overview.stats.userCount}</div>
              <div className="admin-card-label">Users</div>
            </div>
            <div className="admin-card">
              <div className="admin-card-value">{overview.stats.activeSessionCount}</div>
              <div className="admin-card-label">Active sessions</div>
            </div>
            <div className="admin-card">
              <div className="admin-card-value">{overview.stats.eventCache.rowCount}</div>
              <div className="admin-card-label">Cached weeks ({overview.stats.eventCache.distinctSourceCount} sources)</div>
            </div>
            <div className="admin-card">
              <div className="admin-card-value">{formatBytes(overview.stats.resource.dbSizeBytes)}</div>
              <div className="admin-card-label">Database size</div>
            </div>
            <div className="admin-card">
              <div className="admin-card-value">{formatUptime(overview.stats.resource.uptimeSeconds)}</div>
              <div className="admin-card-label">Server uptime</div>
            </div>
            <div className="admin-card">
              <div className="admin-card-value">{formatBytes(overview.stats.resource.rssBytes)}</div>
              <div className="admin-card-label">Memory (RSS)</div>
            </div>
          </div>

          <div className="dialog-section-title">Users ({overview.users.length})</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Joined</th>
                <th>Views</th>
                <th>Custom sources</th>
              </tr>
            </thead>
            <tbody>
              {overview.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name}</td>
                  <td>{u.createdAt}</td>
                  <td>{u.viewCount}</td>
                  <td>{u.customSourceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="dialog-section-title">Submitted custom calendars ({overview.customSources.length})</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Host</th>
                <th>Submitted by</th>
                <th>Linked users</th>
                <th>Last verified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {overview.customSources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </td>
                  <td>{s.host}</td>
                  <td>{s.createdByEmail ?? '-'}</td>
                  <td>{s.linkedUserCount}</td>
                  <td>
                    {s.lastOkAt ?? 'never'}
                    {s.stale && <span className="admin-stale-badge">stale</span>}
                    {checkErrors[s.id] && <div className="error-text">{checkErrors[s.id]}</div>}
                  </td>
                  <td className="admin-table-actions">
                    {promoting === s.id ? (
                      <PromoteForm sourceId={s.id} programs={overview.existingPrograms} onDone={() => setPromoting(null)} />
                    ) : (
                      <>
                        <button
                          className="btn"
                          onClick={() => checkMutation.mutate(s.id)}
                          disabled={checkMutation.isPending}
                        >
                          Check now
                        </button>
                        <button className="btn btn-primary" onClick={() => setPromoting(s.id)}>
                          Promote
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="dialog-section-title">Predefined calendars ({overview.defaultSources.length})</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Program</th>
                <th>Title</th>
                <th>Host</th>
                <th>Group</th>
                <th>Linked users</th>
              </tr>
            </thead>
            <tbody>
              {overview.defaultSources.map((s) => (
                <tr key={s.id}>
                  <td>{s.program ?? '-'}</td>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </td>
                  <td>{s.host}</td>
                  <td>{s.groupPath.join(' / ') || '-'}</td>
                  <td>{s.linkedUserCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
