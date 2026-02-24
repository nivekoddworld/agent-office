import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Box, Text } from "@mantine/core";

interface MarkdownContentProps {
  content: string;
}

const MD_PATTERN = /[#*`[\]|>~]{2,}|```|^\s*[-*+] |^\s*\d+\. |^\s*>/m;

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!MD_PATTERN.test(content)) {
    return (
      <Text
        size="sm"
        style={{ color: "var(--ao-text-primary)", whiteSpace: "pre-wrap" }}
      >
        {content}
      </Text>
    );
  }

  return (
    <Box
      className="markdown-body"
      style={{
        color: "var(--ao-text-primary)",
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
