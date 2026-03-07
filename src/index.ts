import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const JENKINS_URL = process.env.JENKINS_URL;
const JENKINS_USER = process.env.JENKINS_USER;
const JENKINS_TOKEN = process.env.JENKINS_TOKEN;
const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "3000");

if (!JENKINS_URL) {
  console.error("❌ Error: JENKINS_URL environment variable is missing.");
}
if (!JENKINS_TOKEN) {
  console.error("❌ Error: JENKINS_TOKEN environment variable is missing.");
}
if (JENKINS_URL && JENKINS_TOKEN) {
  console.error(`✅ Jenkins MCP Server initialized for URL: ${JENKINS_URL}`);
  console.error(`✅ Authentication: ${JENKINS_USER ? 'Basic (User+Token)' : 'Bearer Token'}`);
}

// Create axios instance for Jenkins API
const jenkinsApi = axios.create({
  baseURL: JENKINS_URL,
  auth: (JENKINS_USER && JENKINS_TOKEN) ? {
    username: JENKINS_USER,
    password: JENKINS_TOKEN,
  } : undefined,
  headers: !JENKINS_USER ? {
    'Authorization': `Bearer ${JENKINS_TOKEN}`
  } : {}
});

/**
 * Helper: Fetch Jenkins Crumb for CSRF protection
 */
async function getCrumbHeaders(): Promise<Record<string, string>> {
  try {
    const response = await jenkinsApi.get("/crumbIssuer/api/json");
    const { crumb, crumbRequestField } = response.data;
    return { [crumbRequestField]: crumb };
  } catch (error) {
    // Crumb might be disabled on some Jenkins instances
    return {};
  }
}

// Initialize the industrial-grade MCP server
const server = new McpServer({
  name: "Jenkins-Industrial-Server",
  version: "1.0.0",
});

/**
 * TOOL: list_jobs
 * Purpose: Allows the AI to discover available Jenkins jobs.
 */
server.tool(
  "list_jobs",
  "List all available jobs from the connected Jenkins instance",
  {}, // No arguments needed for the basic list
  async () => {
    try {
      if (!JENKINS_URL || !JENKINS_TOKEN) {
        throw new Error("Jenkins configuration missing (URL or Token)");
      }

      const response = await jenkinsApi.get("/api/json?tree=jobs[name,url,color]");
      const jobs = response.data.jobs || [];

      if (jobs.length === 0) {
        return {
          content: [{ type: "text", text: "No jobs found in this Jenkins instance." }]
        };
      }

      const jobsText = jobs.map((job: any) =>
        `- ${job.name} (${job.color}): ${job.url}`
      ).join("\n");

      return {
        content: [{ type: "text", text: `Available Jenkins Jobs:\n${jobsText}` }]
      };
    } catch (error: any) {
      const errorMessage = error.response ?
        `Jenkins API error: ${error.response.status} ${error.response.statusText}` :
        `Error: ${error.message}`;

      return {
        content: [{ type: "text", text: `Error fetching jobs from Jenkins: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: search_jobs
 * Purpose: Search for jobs by name pattern.
 */
server.tool(
  "search_jobs",
  "Search for jobs by name pattern",
  {
    pattern: z.string().describe("Part of the job name to search for (e.g., 'prod' or 'backend')")
  },
  async ({ pattern }) => {
    try {
      const response = await jenkinsApi.get("/api/json?tree=jobs[name,url,color]");
      const jobs = response.data.jobs || [];
      const filtered = jobs.filter((job: any) =>
        job.name.toLowerCase().includes(pattern.toLowerCase())
      );

      if (filtered.length === 0) {
        return {
          content: [{ type: "text", text: `No jobs found matching pattern: ${pattern}` }]
        };
      }

      const jobsText = filtered.map((job: any) =>
        `- ${job.name} (${job.color}): ${job.url}`
      ).join("\n");

      return {
        content: [{ type: "text", text: `Search Results for "${pattern}":\n${jobsText}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error searching jobs: ${error.message}` }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: get_job_info
 * Purpose: Get detailed information about a job.
 */
server.tool(
  "get_job_info",
  "Get detailed configuration and build summary for a job",
  {
    jobName: z.string().describe("The name of the Jenkins job")
  },
  async ({ jobName }) => {
    try {
      const response = await jenkinsApi.get(`/job/${jobName}/api/json`);
      const data = response.data;

      const paramsData = (data.property || []).find((p: any) => p._class === "hudson.model.ParametersDefinitionProperty");
      const params = paramsData?.parameterDefinitions || [];
      const paramSummary = params.length > 0 ?
        `Parameters:\n${params.map((p: any) => `  - ${p.name} (${p.type}): ${p.description || "No description"}`).join("\n")}` :
        "Parameters: None";

      const summary = [
        `Name: ${data.name}`,
        `Description: ${data.description || "No description"}`,
        `Latest Build: #${data.lastBuild?.number || "None"}`,
        `Last Successful: #${data.lastSuccessfulBuild?.number || "None"}`,
        `Last Failed: #${data.lastFailedBuild?.number || "None"}`,
        paramSummary,
        `URL: ${data.url}`
      ].join("\n");

      return {
        content: [{ type: "text", text: `Job Information: ${jobName}\n\n${summary}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error fetching job info for ${jobName}: ${error.message}` }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: list_builds
 * Purpose: List recent builds for a specific job.
 */
server.tool(
  "list_builds",
  "List recent builds for a specific Jenkins job",
  {
    jobName: z.string().describe("The name of the Jenkins job"),
    limit: z.number().optional().default(10).describe("Number of builds to return (default 10)")
  },
  async ({ jobName, limit }) => {
    try {
      const response = await jenkinsApi.get(`/job/${jobName}/api/json?tree=builds[number,url,result,timestamp]{0,${limit}}`);
      const builds = response.data.builds || [];

      if (builds.length === 0) {
        return {
          content: [{ type: "text", text: `No builds found for job: ${jobName}` }]
        };
      }

      const buildList = builds.map((b: any) =>
        `#${b.number} - Result: ${b.result || "IN PROGRESS"} (${new Date(b.timestamp).toLocaleString()})`
      ).join("\n");

      return {
        content: [{ type: "text", text: `Recent Builds for ${jobName}:\n${buildList}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error listing builds for ${jobName}: ${error.message}` }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: get_build_status
 * Purpose: Get details of a specific build or the latest build for a job.
 */
server.tool(
  "get_build_status",
  "Get the status and details of a specific Jenkins build",
  {
    jobName: z.string().describe("The name of the Jenkins job"),
    buildId: z.union([z.string(), z.number()]).optional().describe("Build number or 'lastBuild', 'lastSuccessfulBuild', etc. Defaults to 'lastBuild'")
  },
  async ({ jobName, buildId = "lastBuild" }) => {
    try {
      const response = await jenkinsApi.get(`/job/${jobName}/${buildId}/api/json`);
      const data = response.data;

      const duration = data.duration ? `${(data.duration / 1000).toFixed(2)}s` : "N/A";
      const timestamp = new Date(data.timestamp).toLocaleString();

      // Extract commit information
      const changes = data.changeSet?.items || [];
      const changeSummary = changes.length > 0
        ? `\nChanges:\n${changes.map((c: any) => `  - [${c.author.fullName}] ${c.msg}`).join("\n")}`
        : "\nChanges: No commits in this build.";

      const summary = [
        `Job: ${jobName}`,
        `Build: #${data.number}`,
        `Result: ${data.result || "IN PROGRESS"}`,
        `Timestamp: ${timestamp}`,
        `Duration: ${duration}`,
        changeSummary,
        `URL: ${data.url}`
      ].join("\n");

      return {
        content: [{ type: "text", text: `Jenkins Build Status:\n${summary}` }]
      };
    } catch (error: any) {
      const errorMessage = error.response ?
        `Jenkins API error: ${error.response.status} ${error.response.statusText}` :
        `Error: ${error.message}`;

      return {
        content: [{ type: "text", text: `Error fetching build status for ${jobName}: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: trigger_build
 * Purpose: Trigger a new build for a job. Includes safety confirmation.
 */
server.tool(
  "trigger_build",
  "Trigger a new build for a Jenkins job. Requires confirmation.",
  {
    jobName: z.string().describe("The name of the Jenkins job"),
    parameters: z.record(z.string(), z.any()).optional().describe("Optional build parameters"),
    confirmed: z.boolean().optional().default(false).describe("Must be set to true to actually trigger the build")
  },
  async ({ jobName, parameters, confirmed }) => {
    if (!confirmed) {
      const paramStr = parameters ? ` with parameters: ${JSON.stringify(parameters)}` : "";
      return {
        content: [{
          type: "text",
          text: `⚠️ SAFETY CHECK: You are about to trigger a build for job "${jobName}"${paramStr}. Please confirm by setting 'confirmed: true'.`
        }]
      };
    }

    try {
      const endpoint = parameters ? `/job/${jobName}/buildWithParameters` : `/job/${jobName}/build`;
      const crumbHeaders = await getCrumbHeaders();
      const response = await jenkinsApi.post(endpoint, null, {
        params: parameters,
        headers: crumbHeaders
      });

      // Jenkins usually returns 201 Created on success
      const statusText = response.status === 201 ? "Build triggered successfully." : "Trigger request sent.";

      return {
        content: [{
          type: "text",
          text: `${statusText} Check build queue or job page for progress. (Location: ${response.headers.location || "N/A"})`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response ?
        `Jenkins API error: ${error.response.status} ${error.response.statusText}` :
        `Error: ${error.message}`;

      return {
        content: [{ type: "text", text: `Error triggering build for ${jobName}: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: stop_build
 * Purpose: Stop/Abort a running Jenkins build. Includes safety confirmation.
 */
server.tool(
  "stop_build",
  "Stop or abort a running Jenkins build. Requires confirmation.",
  {
    jobName: z.string().describe("The name of the Jenkins job"),
    buildId: z.union([z.string(), z.number()]).describe("The build number to stop"),
    confirmed: z.boolean().optional().default(false).describe("Must be set to true to actually stop the build")
  },
  async ({ jobName, buildId, confirmed }) => {
    if (!confirmed) {
      return {
        content: [{
          type: "text",
          text: `⚠️ SAFETY CHECK: You are about to STOP build #${buildId} for job "${jobName}". Please confirm by setting 'confirmed: true'.`
        }]
      };
    }

    try {
      const crumbHeaders = await getCrumbHeaders();
      await jenkinsApi.post(`/job/${jobName}/${buildId}/stop`, null, {
        headers: crumbHeaders
      });

      return {
        content: [{
          type: "text",
          text: `Stop request sent for ${jobName} #${buildId}.`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response ?
        `Jenkins API error: ${error.response.status} ${error.response.statusText}` :
        `Error: ${error.message}`;

      return {
        content: [{ type: "text", text: `Error stopping build ${jobName} #${buildId}: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

/**
 * RESOURCE: jenkins://{job}/logs/{id}
 * Purpose: Fetch console logs for a specific build.
 */
server.resource(
  "console_logs",
  "jenkins://{job}/logs/{id}",
  async (uri) => {
    const match = uri.href.match(/^jenkins:\/\/([^/]+)\/logs\/([^/]+)$/);
    if (!match) {
      throw new Error(`Invalid URI: ${uri.href}. Expected format: jenkins://{job}/logs/{id}`);
    }
    const [, job, id] = match;

    try {
      const response = await jenkinsApi.get(`/job/${job}/${id}/consoleText`);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: response.data
        }]
      };
    } catch (error: any) {
      throw new Error(`Error fetching logs for ${job} #${id}: ${error.message}`);
    }
  }
);

/**
 * PROMPT: analyze-failure
 * Purpose: Template for debugging Jenkins build log errors.
 */
server.prompt(
  "analyze-failure",
  {
    jobName: z.string().describe("The name of the Jenkins job"),
    buildId: z.string().describe("The build number to analyze")
  },
  ({ jobName, buildId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please analyze the failure for Jenkins job "${jobName}" build #${buildId}. 
You can fetch the console logs using the resource "jenkins://${jobName}/logs/${buildId}".
Look for stack traces, compilation errors, or environment issues that might have caused the build to fail.`
      }
    }]
  })
);

// Start the server using the selected transport
async function main() {
  if (TRANSPORT === "sse") {
    const app = express();
    let transport: SSEServerTransport | null = null;

    app.get("/sse", async (req, res) => {
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
      console.error(`New SSE connection established`);
    });

    app.post("/messages", async (req, res) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No active SSE session");
      }
    });

    app.listen(PORT, () => {
      console.error(`Jenkins MCP Server running on SSE at http://localhost:${PORT}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Jenkins MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
