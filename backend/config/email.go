package config

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

type Mailer struct {
	host string
	port string
	user string
	pass string
	from string
}

func NewMailer(host, port, user, pass, from string) *Mailer {
	return &Mailer{host: host, port: port, user: user, pass: pass, from: from}
}

func (m *Mailer) Send(to, subject, body string) error {
	if m.host == "" {
		return fmt.Errorf("mailer: SMTP_HOST is not configured")
	}
	addr := net.JoinHostPort(m.host, m.port)
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("mailer: dial %s: %w", addr, err)
	}
	defer conn.Close()
	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return fmt.Errorf("mailer: smtp client: %w", err)
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{ServerName: m.host}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("mailer: starttls: %w", err)
		}
	}
	if m.user != "" {
		auth := smtp.PlainAuth("", m.user, m.pass, m.host)
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(auth); err != nil {
				return fmt.Errorf("mailer: auth: %w", err)
			}
		}
	}
	fromAddr := extractAddr(m.from)
	if err := client.Mail(fromAddr); err != nil {
		return fmt.Errorf("mailer: MAIL FROM: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("mailer: RCPT TO: %w", err)
	}
	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("mailer: DATA: %w", err)
	}
	msg := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\n\r\n%s\r\n",
		m.from, to, subject, body,
	)
	if _, err := wc.Write([]byte(msg)); err != nil {
		return fmt.Errorf("mailer: write body: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("mailer: close data: %w", err)
	}
	return client.Quit()
}

func extractAddr(from string) string {
	start := strings.Index(from, "<")
	end := strings.Index(from, ">")
	if start >= 0 && end > start {
		return from[start+1 : end]
	}
	return strings.TrimSpace(from)
}
