-- Pictures and GIF widgets: two new providers. Used by the next migration's rows only after this one commits.
ALTER TYPE "WidgetProvider" ADD VALUE 'PICTURES';
ALTER TYPE "WidgetProvider" ADD VALUE 'GIF';
