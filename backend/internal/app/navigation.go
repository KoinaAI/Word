package app

import (
	"context"
	"net/http"
	"strings"
)

func readNavigation(ctx context.Context, db querier) ([]Navigation, error) {
	rows, err := db.QueryContext(ctx, "SELECT id,label,path,icon,enabled,sort_order FROM navigation ORDER BY sort_order,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Navigation{}
	for rows.Next() {
		var item Navigation
		if err := rows.Scan(&item.ID, &item.Label, &item.Path, &item.Icon, &item.Enabled, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *App) navigation(w http.ResponseWriter, r *http.Request, u User) error {
	items, err := readNavigation(r.Context(), a.db)
	if err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, items)
}

func (a *App) putNavigation(w http.ResponseWriter, r *http.Request, u User) error {
	var input struct {
		Items []Navigation `json:"items"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if len(input.Items) < 1 || len(input.Items) > 4 {
		return problem(http.StatusBadRequest, "navigation must contain between 1 and 4 supported modules")
	}
	paths := map[string]bool{}
	ids := map[int64]bool{}
	navigationEnabled := false
	for i := range input.Items {
		item := &input.Items[i]
		item.Label = strings.TrimSpace(item.Label)
		item.Icon = strings.TrimSpace(item.Icon)
		switch item.Path {
		case "/admin", "/admin/books", "/admin/users", "/admin/navigation":
		default:
			return problem(http.StatusBadRequest, "unsupported navigation path")
		}
		if item.ID < 1 || !validText(item.Label, 1, 80) || !validText(item.Icon, 0, 80) || item.SortOrder < 0 || item.SortOrder > 10000 {
			return problem(http.StatusBadRequest, "invalid navigation id, label, icon or sortOrder")
		}
		if paths[item.Path] || ids[item.ID] {
			return problem(http.StatusBadRequest, "navigation ids and paths must be unique")
		}
		paths[item.Path], ids[item.ID] = true, true
		navigationEnabled = navigationEnabled || (item.Path == "/admin/navigation" && item.Enabled)
	}
	if !navigationEnabled {
		return problem(http.StatusBadRequest, "the navigation module must stay enabled")
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM navigation"); err != nil {
		return err
	}
	for _, item := range input.Items {
		if _, err = tx.ExecContext(r.Context(), "INSERT INTO navigation(id,label,path,icon,enabled,sort_order) VALUES(?,?,?,?,?,?)", item.ID, item.Label, item.Path, item.Icon, item.Enabled, item.SortOrder); err != nil {
			return err
		}
	}
	items, err := readNavigation(r.Context(), tx)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, items)
}
