self.__BUILD_MANIFEST = {
  "__rewrites": {
    "afterFiles": [
      {
        "source": "/api/v1/:path*"
      },
      {
        "source": "/uploads/:path*"
      },
      {
        "source": "/admin/whatsapp"
      },
      {
        "source": "/admin/whatsapp/:path*"
      },
      {
        "source": "/:slug((?!_next|api|uploads|assets|static|favicon.ico)[a-z0-9][a-z0-9-]*)/login",
        "destination": "/login"
      },
      {
        "source": "/:slug((?!_next|api|uploads|assets|static|favicon.ico)[a-z0-9][a-z0-9-]*)/reset",
        "destination": "/reset"
      },
      {
        "source": "/:slug((?!_next|api|uploads|assets|static|favicon.ico)[a-z0-9][a-z0-9-]*)",
        "destination": "/app"
      },
      {
        "source": "/:slug((?!_next|api|uploads|assets|static|favicon.ico)[a-z0-9][a-z0-9-]*)/:route",
        "destination": "/app"
      },
      {
        "source": "/:slug((?!_next|api|uploads|assets|static|favicon.ico)[a-z0-9][a-z0-9-]*)/:route/:arg",
        "destination": "/app"
      }
    ],
    "beforeFiles": [],
    "fallback": []
  },
  "sortedPages": [
    "/_app",
    "/_error"
  ]
};self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()