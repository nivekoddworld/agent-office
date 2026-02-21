import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Box, Text } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";

interface MarkdownContentProps {
  content: string;
}

const MD_PATTERN = /[#*`[\]|>~]{2,}|```|^\s*[-*+] |^\s*\d+\. |^\s*>/m;

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!MD_PATTERN.test(content)) {
    return (
      <Text
        size="sm"
        style={{ color: slack.textPrimary, whiteSpace: "pre-wrap" }}
      >
        {content}
      </Text>
    );
  }

  return (
    <Box
      className="markdown-body"
      style={{
        color: slack.textPrimary,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
