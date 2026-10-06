import React from "react";

export function SlackIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <title>Slack</title>
      <path
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
        fill="#E01E5A"
      />
      <path
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
        fill="#36C5F0"
      />
      <path
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
        fill="#2EB67D"
      />
      <path
        d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
        fill="#ECB22E"
      />
    </svg>
  );
}

export function GmailIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Gmail</title>
      <path
        fill="#4285F4"
        d="M1.5 19.5V8.25l10.5 7.5 10.5-7.5V19.5c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5z"
      />
      <path
        fill="#34A853"
        d="M22.5 4.5H21v3.75l-9 6.43-9-6.43V4.5H1.5C.67 4.5 0 5.17 0 6v13.5c0 .83.67 1.5 1.5 1.5H3V9.75l9 6.43 9-6.43V21h1.5c.83 0 1.5-.67 1.5-1.5V6c0-.83-.67-1.5-1.5-1.5z"
      />
      <path fill="#EA4335" d="M22.5 4.5L12 12 1.5 4.5 3 3.38 12 9.75l9-6.37 1.5 1.12z" />
      <path
        fill="#FBBC05"
        d="M21 3.38V4.5L12 10.88 3 4.5V3.38C3 2.62 3.82 2.15 4.5 2.56L12 7.5l7.5-4.94c.68-.41 1.5.06 1.5.82z"
      />
    </svg>
  );
}

export function GoogleCalendarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Google Calendar</title>
      <rect x="2" y="4" width="20" height="18" rx="3" fill="#FFFFFF" />
      <rect x="2" y="4" width="20" height="5" rx="1" fill="#4285F4" />
      <circle cx="7" cy="3" r="1.5" fill="#1A73E8" />
      <circle cx="17" cy="3" r="1.5" fill="#1A73E8" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fill="#1A73E8"
        fontSize="9"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        31
      </text>
    </svg>
  );
}

export function OutlookCalendarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Outlook Calendar</title>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#2563EB" />
      <rect x="5" y="8" width="14" height="10" rx="1.5" fill="#1E40AF" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="8"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        31
      </text>
    </svg>
  );
}

export function GoogleDriveIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Google Drive</title>
      <path d="M7.7 3.5h8.6L24 16.5h-8.6L7.7 3.5z" fill="#FFC107" />
      <path d="M0 16.5l3.8-6.5 7.7 13.5H3.8L0 16.5z" fill="#0066DA" />
      <path d="M15.4 16.5H0l4.3 7h15.4l-4.3-7z" fill="#00AC47" />
    </svg>
  );
}

export function TeamsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Microsoft Teams</title>
      <rect x="5" y="5" width="14" height="14" rx="3" fill="#505AC9" />
      <circle cx="16" cy="8" r="2.5" fill="#7B83EB" />
      <path d="M14 12h4c1 0 2 .8 2 1.8V16h-6v-4z" fill="#7B83EB" />
      <circle cx="10" cy="9" r="3" fill="#FFFFFF" />
      <path d="M7 14h6c1.1 0 2 .9 2 2v2H5v-2c0-1.1.9-2 2-2z" fill="#FFFFFF" />
      <text
        x="9.5"
        y="17"
        textAnchor="middle"
        fill="#505AC9"
        fontSize="8"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        T
      </text>
    </svg>
  );
}

export function OutlookIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Outlook</title>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#0078D4" />
      <rect x="2" y="6" width="10" height="12" rx="2" fill="#106EBE" />
      <text
        x="7"
        y="15"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="9"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        O
      </text>
      <path d="M12 9l8 5.5V8.5L12 9z" fill="#FFFFFF" opacity="0.8" />
    </svg>
  );
}

export function SharePointIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>SharePoint</title>
      <circle cx="14" cy="9" r="5" fill="#038387" />
      <circle cx="9" cy="14" r="5" fill="#005B5C" />
      <circle cx="15" cy="15" r="4" fill="#004A4D" />
      <text
        x="10"
        y="16.5"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="8"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        S
      </text>
    </svg>
  );
}

export function AsanaIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Asana</title>
      <circle cx="12" cy="7" r="4.5" fill="#F06A6A" />
      <circle cx="6.5" cy="16.5" r="4.5" fill="#F06A6A" />
      <circle cx="17.5" cy="16.5" r="4.5" fill="#F06A6A" />
    </svg>
  );
}

export function BoxIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <title>Box</title>
      <rect x="3" y="5" width="18" height="14" rx="3" fill="#0061D5" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="8"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        box
      </text>
    </svg>
  );
}

export function GitHubIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <title>GitHub</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export function LinearIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <title>Linear</title>
      <path d="M3.2 4.8L4.8 3.2l16 16-1.6 1.6L3.2 4.8z" fill="#5E6AD2" />
      <path d="M8 3.5l12.5 12.5-1.5 1.5L6.5 5 8 3.5z" fill="#5E6AD2" />
      <path d="M13 3l8 8-1.5 1.5-8-8L13 3z" fill="#5E6AD2" />
    </svg>
  );
}

export function NotionIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <title>Notion</title>
      <rect width="24" height="24" rx="4" fill="#000000" />
      <path d="M4.5 5.5v13h2.5l7-9.5v9.5h3v-13h-2.5l-7 9.5v-9.5h-3z" fill="#FFFFFF" />
    </svg>
  );
}

export function SalesforceIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#00A1E0">
      <title>Salesforce</title>
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
    </svg>
  );
}
