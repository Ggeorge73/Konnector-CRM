"use client";
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import Badge from "@mui/icons-material/BadgeOutlined";
import Business from "@mui/icons-material/BusinessOutlined";
import Campaign from "@mui/icons-material/CampaignOutlined";
import Code from "@mui/icons-material/Code";
import Contacts from "@mui/icons-material/ContactsOutlined";
import Event from "@mui/icons-material/EventOutlined";
import FactCheck from "@mui/icons-material/FactCheckOutlined";
import History from "@mui/icons-material/History";
import HubIcon from "@mui/icons-material/Hub";
import Insights from "@mui/icons-material/Insights";
import Mail from "@mui/icons-material/MailOutlined";
import Outbox from "@mui/icons-material/OutboxOutlined";
import Policy from "@mui/icons-material/PolicyOutlined";
import Public from "@mui/icons-material/Public";
import RequestQuote from "@mui/icons-material/RequestQuoteOutlined";
import Settings from "@mui/icons-material/SettingsOutlined";
import TaskAlt from "@mui/icons-material/TaskAlt";
import UploadFile from "@mui/icons-material/UploadFileOutlined";
import Verified from "@mui/icons-material/VerifiedOutlined";
import ViewKanban from "@mui/icons-material/ViewKanbanOutlined";

export const NAV_ICONS: Record<string, React.ReactNode> = {
  public: <Public fontSize="small" />,
  task: <TaskAlt fontSize="small" />,
  business: <Business fontSize="small" />,
  contacts: <Contacts fontSize="small" />,
  view_kanban: <ViewKanban fontSize="small" />,
  insights: <Insights fontSize="small" />,
  event: <Event fontSize="small" />,
  request_quote: <RequestQuote fontSize="small" />,
  outbox: <Outbox fontSize="small" />,
  badge: <Badge fontSize="small" />,
  campaign: <Campaign fontSize="small" />,
  verified: <Verified fontSize="small" />,
  policy: <Policy fontSize="small" />,
  settings: <Settings fontSize="small" />,
  history: <History fontSize="small" />,
  hub: <HubIcon fontSize="small" />,
  code: <Code fontSize="small" />,
  mail: <Mail fontSize="small" />,
  auto_awesome: <AutoAwesome fontSize="small" />,
  upload: <UploadFile fontSize="small" />,
  fact_check: <FactCheck fontSize="small" />,
};
