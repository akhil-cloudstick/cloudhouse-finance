package controllers

import (
	"net/http"
)

type StatusedError interface {
	error
	Status() int
}

type CodedError struct {
	msg    string
	status int
}

func (e *CodedError) Error() string { return e.msg }

func (e *CodedError) Status() int { return e.status }

func NewNotFound(msg string) error { return &CodedError{msg, http.StatusNotFound} }

func NewBadRequest(msg string) error { return &CodedError{msg, http.StatusBadRequest} }

func NewConflict(msg string) error { return &CodedError{msg, http.StatusConflict} }

func NewForbidden(msg string) error { return &CodedError{msg, http.StatusForbidden} }

func NewUnauthorized(msg string) error { return &CodedError{msg, http.StatusUnauthorized} }

func NewUnavailable(msg string) error { return &CodedError{msg, http.StatusServiceUnavailable} }
