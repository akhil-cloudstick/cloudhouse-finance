package routers

import (
	"cloudhouse/backend/auth"
	reminder "cloudhouse/backend/modules/Reminder/controllers"

	"github.com/labstack/echo/v4"
)

var reminderPath = "/api/v1/users/:user_id/reminders"

func ReminderRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("reminders")
	e.POST(reminderPath, reminder.CreateReminder, auth.Staff(perms.Create)...)
	e.GET(reminderPath, reminder.ListReminders, auth.Staff(perms.Read)...)
	e.GET(reminderPath+"/calendar", reminder.GetReminderCalendar, auth.Staff(perms.Read)...)
	e.GET(reminderPath+"/:id", reminder.GetReminderById, auth.Staff(perms.Read)...)
	e.PATCH(reminderPath+"/:id/update", reminder.UpdateReminder, auth.Staff(perms.Update)...)
	e.PATCH(reminderPath+"/:id/complete", reminder.CompleteReminder, auth.Staff(perms.Update)...)
	e.PATCH(reminderPath+"/:id/send-whatsapp", reminder.SendReminderWhatsApp, auth.Staff(perms.Update)...)
	e.DELETE(reminderPath+"/:id/delete", reminder.DeleteReminder, auth.Staff(perms.Delete)...)
	return e
}
