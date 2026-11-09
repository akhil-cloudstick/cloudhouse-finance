package localapi

import (
	"context"
	"strconv"

	"gorm.io/gorm"
	"gorm.io/gorm/callbacks"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/migrator"
	"gorm.io/gorm/schema"
)

// dialector lets GORM build SQLite statements over a connection that is already open. It is the part of the usual SQLite
// dialect that reading needs (quoting, LIMIT, locking clauses). The usual package also registers its own database driver,
// which collides with the one the desktop app already uses, so it is not imported here.
type dialector struct{ conn gorm.ConnPool }

func (d dialector) Name() string { return "sqlite" }

func (d dialector) Initialize(db *gorm.DB) error {
	db.ConnPool = d.conn
	callbacks.RegisterDefaultCallbacks(db, &callbacks.Config{
		CreateClauses:        []string{"INSERT", "VALUES", "ON CONFLICT", "RETURNING"},
		UpdateClauses:        []string{"UPDATE", "SET", "FROM", "WHERE", "RETURNING"},
		DeleteClauses:        []string{"DELETE", "FROM", "WHERE", "RETURNING"},
		LastInsertIDReversed: true,
	})
	for k, v := range d.clauseBuilders() {
		db.ClauseBuilders[k] = v
	}
	return nil
}

func (d dialector) clauseBuilders() map[string]clause.ClauseBuilder {
	return map[string]clause.ClauseBuilder{
		"LIMIT": func(c clause.Clause, builder clause.Builder) {
			if limit, ok := c.Expression.(clause.Limit); ok {
				lmt := -1
				if limit.Limit != nil && *limit.Limit >= 0 {
					lmt = *limit.Limit
				}
				if lmt >= 0 || limit.Offset > 0 {
					builder.WriteString("LIMIT ")
					builder.WriteString(strconv.Itoa(lmt))
				}
				if limit.Offset > 0 {
					builder.WriteString(" OFFSET ")
					builder.WriteString(strconv.Itoa(limit.Offset))
				}
			}
		},
		"FOR": func(c clause.Clause, builder clause.Builder) {
			if _, ok := c.Expression.(clause.Locking); ok {
				return // SQLite has no row locks
			}
			c.Build(builder)
		},
	}
}

func (d dialector) DefaultValueOf(field *schema.Field) clause.Expression {
	if field.AutoIncrement {
		return clause.Expr{SQL: "NULL"}
	}
	return clause.Expr{SQL: "DEFAULT"}
}

func (d dialector) Migrator(db *gorm.DB) gorm.Migrator {
	return migrator.Migrator{Config: migrator.Config{DB: db, Dialector: d}}
}

func (d dialector) BindVarTo(writer clause.Writer, stmt *gorm.Statement, v interface{}) {
	writer.WriteByte('?')
}

func (d dialector) QuoteTo(writer clause.Writer, str string) {
	writer.WriteByte('`')
	for _, c := range []byte(str) {
		switch c {
		case '`':
			writer.WriteString("``")
		case '.':
			writer.WriteString("`.`")
		default:
			writer.WriteByte(c)
		}
	}
	writer.WriteByte('`')
}

func (d dialector) Explain(sql string, vars ...interface{}) string {
	return logger.ExplainSQL(sql, nil, `"`, vars...)
}

func (d dialector) DataTypeOf(field *schema.Field) string {
	switch field.DataType {
	case schema.Bool, schema.Int, schema.Uint:
		return "integer"
	case schema.Float:
		return "real"
	case schema.Bytes:
		return "blob"
	case schema.Time:
		return "datetime"
	}
	return "text"
}

// ping is unused by GORM but keeps the pool honest at start-up.
func ping(ctx context.Context, p gorm.ConnPool) error {
	return p.QueryRowContext(ctx, "select 1").Err()
}

// SavePoint and RollbackTo let a handler's own transaction run inside the one a replay holds open (GORM turns a nested
// Transaction into a savepoint), so a step the server would refuse is undone without losing the steps before it.
func (d dialector) SavePoint(tx *gorm.DB, name string) error {
	return tx.Exec("SAVEPOINT " + name).Error
}

func (d dialector) RollbackTo(tx *gorm.DB, name string) error {
	return tx.Exec("ROLLBACK TO SAVEPOINT " + name).Error
}
