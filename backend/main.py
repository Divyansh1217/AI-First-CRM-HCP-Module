# backend/main.py
from fastapi import FastAPI, HTTPException, Body, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError
from typing import List, Optional, Dict, Any, Union, Literal
import datetime
import uuid
import asyncio
import os # For accessing environment variables
import uvicorn
import json # For JSON serialization/deserialization

# --- MySQL Database Imports ---
from sqlalchemy.orm import Session
# Assuming database.py and models.py are correctly set up in the same directory
from database import SessionLocal, engine, get_db, Base # Import Base
from models import InteractionLogDB # Import your SQLAlchemy model

# --- LangChain & LangGraph Imports ---
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_core.tools import tool
from langchain_groq import ChatGroq # Import ChatGroq
from langgraph.graph import StateGraph, END
from pydantic import SecretStr # For handling API keys securely

# --- Pydantic Models for API Request/Response & Internal Use ---

class ChatMessage(BaseModel):
    """Represents a single message in the chat history."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())) # Unique ID for each message
    text: str
    sender: str # 'user' or 'ai'
    type: str = "text" # 'text', 'draft', 'error' - aligns with frontend

class ChatSession(BaseModel):
    """Represents a chat session, including the current message and history."""
    message: str # The current user message
    history: List[ChatMessage] # Previous messages in the conversation

class ChatResponse(BaseModel):
    """Represents the AI's response in the chat."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())) # Unique ID for the AI response
    reply: str
    type: str = "text" # 'text', 'draft', 'error' - aligns with frontend

class LogConfirmation(BaseModel):
    message: str
    log_id: int # Can be UUID or database ID

class HCPLogResponse(BaseModel):
    """
    Response model for fetching logged HCP interactions.
    Formats dates to DD-MM-YYYY strings and times to HH:MM strings.
    """
    id: int
    hcpName: str
    interactionDate: str # Formatted as DD-MM-YYYY
    interactionTime: Optional[str] = None # Formatted as HH:MM
    interactionType: str
    attendees: List[str]
    topicsDiscussed: str
    materialsShared: List[str]
    samplesDistributed: List[str]
    hcpSentiment: Optional[str] = None
    outcomes: Optional[str] = None
    followUpActions: Optional[str] = None
    timestamp: str # ISO format string

class HCPInteractionForm(BaseModel):
    """
    Data model for logging HCP interactions via the structured form.
    Also used internally for chat confirmation after pre-parsing.
    Expects dates as YYYY-MM-DD and times as HH:MM.
    """
    hcpName: str = Field(..., min_length=1, max_length=100, description="Name of the Healthcare Professional")
    interactionDate: datetime.date = Field(..., description="Date of the interaction (YYYY-MM-DD)")
    interactionTime: Optional[datetime.time] = Field(None, description="Time of the interaction (HH:MM)")
    interactionType: Literal['Meeting', 'Call', 'Email', 'Conference', 'Other', ''] = Field('Meeting', description="Type of interaction (e.g., Call, Meeting)")
    attendees: List[str] = Field(default_factory=list, description="List of attendees")
    topicsDiscussed: str = Field(..., min_length=1, description="Key discussion points of the interaction")
    materialsShared: List[str] = Field(default_factory=list, description="List of materials shared")
    samplesDistributed: List[str] = Field(default_factory=list, description="List of samples distributed")
    hcpSentiment: Optional[Literal['Positive', 'Neutral', 'Negative', '']] = Field('', description="Observed/inferred HCP sentiment (Positive, Neutral, Negative)")
    outcomes: str = Field("", max_length=500, description="Key outcomes or agreements")
    followUpActions: str = Field("", max_length=500, description="Planned follow-up actions")


# --- FastAPI Application Setup ---
app = FastAPI(
    title="HCP Interaction Logger API",
    description="API for logging interactions with Healthcare Professionals (HCPs) using Groq (Gemma-2-9B-IT) and LangGraph, storing data in MySQL.",
    version="1.0.0",
    docs_url="/docs", # Custom URL for Swagger UI
    redoc_url="/redoc" # Custom URL for ReDoc
)

# --- CORS Middleware ---
origins = [
    "http://localhost:3000", # Default Create React App port
    "http://localhost:5173", # Default Vite React port
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Initialization on Startup ---
@app.on_event("startup")
async def startup_event():
    # Create database tables if they don't exist
    print("Creating database tables if they don't exist...")
    Base.metadata.create_all(bind=engine)
    print("Database tables checked/created.")

# --- Groq LLM Client for LangChain ---
from dotenv import load_dotenv
load_dotenv() # Load environment variables from .env file

# Groq API key should be set as an environment variable, typically GROQ_API_KEY
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable not set. Please set your Groq API key.")

# Initialize the LLM for LangChain using ChatGroq
llm = ChatGroq(
    model="gemma2-9b-it", # Using Gemma 2 9b IT as specified
    temperature=0, # Set temperature for more consistent responses
    api_key=SecretStr(GROQ_API_KEY) # Pass the Groq API key as SecretStr
)

# --- LangChain Tools ---

@tool
def log_interaction_tool(
    hcpName: str,
    interactionDate: str, # Expected DD-MM-YYYY from LLM for draft display
    topicsDiscussed: str,
    interactionTime: Optional[str] = None, # Expected HH:MM from LLM for draft display
    interactionType: str = "Meeting",
    attendees: Optional[List[str]] = None,
    materialsShared: Optional[List[str]] = None,
    samplesDistributed: Optional[List[str]] = None,
    hcpSentiment: Optional[str] = None,
    outcomes: Optional[str] = None,
    followUpActions: Optional[str] = None,
) -> str:
    """
    Formats structured HCP interaction data into a human-readable draft for frontend display.
    This tool is called by the AI to present the extracted information for user confirmation.
    IMPORTANT: The LLM should provide interactionDate in DD-MM-YYYY format and interactionTime in HH:MM.
    """
    print(f"--- TOOL CALL: log_interaction_tool (for draft generation) ---")
    
    # Ensure sentiment displays correctly, even if LLM provides an empty string or 'N/A'
    sentiment_display = hcpSentiment.strip() if hcpSentiment and hcpSentiment.strip() and hcpSentiment.strip() != 'N/A' else 'N/A'
    
    # Ensure attendees, materials, samples are lists (default_factory handles None from tool args)
    attendees = attendees if attendees is not None else []
    materialsShared = materialsShared if materialsShared is not None else []
    samplesDistributed = samplesDistributed if samplesDistributed is not None else []

    # Construct the draft message for the frontend to populate the form
    reply_text = (
        f"**HCP:** {hcpName if hcpName else 'N/A'}\n"
        f"**Date:** {interactionDate if interactionDate else 'N/A'}\n" # This is DD-MM-YYYY
        f"**Time:** {interactionTime if interactionTime else 'N/A'}\n"
        f"**Type:** {interactionType if interactionType else 'N/A'}\n"
        f"**Attendees:** {', '.join(attendees) if attendees else 'N/A'}\n"
        f"**Topics:** {topicsDiscussed if topicsDiscussed else 'N/A'}\n"
        f"**Materials Shared:** {', '.join(materialsShared) if materialsShared else 'N/A'}\n"
        f"**Samples Distributed:** {', '.join(samplesDistributed) if samplesDistributed else 'N/A'}\n"
        f"**Sentiment:** {sentiment_display}\n"
        f"**Outcomes:** {outcomes if outcomes else 'N/A'}\n"
        f"**Follow-up:** {followUpActions if followUpActions else 'N/A'}"
    )
    # The actual saving to DB happens via /api/log_interaction/chat_confirm endpoint
    return reply_text # This text will be sent to the frontend with type "draft"

@tool
def ask_clarifying_question_tool(question: str) -> str:
    """
    Asks the user a clarifying question to gather more information for logging an interaction.
    This tool should be used when the AI needs more details to complete an interaction log.
    """
    print(f"--- TOOL CALL: ask_clarifying_question_tool ---")
    return question # Return just the question text

@tool
def summarize_interaction_tool(text: str) -> str:
    """
    Summarizes a given text input, useful for condensing long user inputs.
    This tool can be used by the AI to process unstructured text from the user.
    """
    print(f"--- TOOL CALL: summarize_interaction_tool ---")
    # In a real scenario, this would involve another LLM call or a more advanced summarization model.
    return f"Summary of provided text: '{text[:100]}...' (mock summary)"

@tool
def edit_interaction_tool(interaction_id: str, field_to_edit: str, new_value: str) -> str:
    """
    Allows modification of an existing logged interaction.
    This is a placeholder tool for future functionality.
    """
    print(f"--- TOOL CALL: edit_interaction_tool ---")
    # In a real scenario, this would update the database.
    return f"Mock: Interaction {interaction_id} field '{field_to_edit}' updated to '{new_value}'."

@tool
def retrieve_hcp_info_tool(hcp_name: str) -> str:
    """
    Retrieves detailed information about a Healthcare Professional (HCP).
    This is a placeholder tool for future functionality.
    """
    print(f"--- TOOL CALL: retrieve_hcp_info_tool ---")
    # In a real scenario, this would query an HCP database.
    return f"Mock: Retrieved info for {hcp_name}: Speciality: Cardiology, Location: City Hospital."

# List of all tools available to the agent
tools = [
    log_interaction_tool,
    ask_clarifying_question_tool,
    summarize_interaction_tool,
    edit_interaction_tool,
    retrieve_hcp_info_tool
]

llm_with_tools = llm.bind_tools(tools)

# --- LangGraph Agent Setup ---

class AgentState(BaseModel):
    messages: List[BaseMessage] = Field(default_factory=list)

# Define the agent node (LLM interaction)
async def call_llm_node(state: AgentState) -> Dict[str, List[BaseMessage]]:
    """
    Node that calls the LLM with the current conversation history.
    The LLM will decide whether to call a tool or respond directly.
    """
    print(f"--- LANGGRAPH NODE: call_llm_node ---")
    response = await llm_with_tools.ainvoke(state.messages)
    return {"messages": [response]}

# Define the tool node (Tool execution)
async def call_tool_node(state: AgentState) -> Dict[str, List[BaseMessage]]:
    """
    Node that executes the tool recommended by the LLM.
    """
    print(f"--- TOOL CALL: call_tool_node ---")
    last_message = state.messages[-1]
    
    if isinstance(last_message, AIMessage) and last_message.tool_calls:
        tool_outputs = []
        for tool_call in last_message.tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            print(f"Executing tool: {tool_name} with args: {tool_args}")
            try:
                if tool_name == "log_interaction_tool":
                    tool_output_content = await log_interaction_tool.ainvoke(tool_args)
                elif tool_name == "ask_clarifying_question_tool":
                    tool_output_content = await ask_clarifying_question_tool.ainvoke(tool_args)
                elif tool_name == "summarize_interaction_tool":
                    tool_output_content = await summarize_interaction_tool.ainvoke(tool_args)
                elif tool_name == "edit_interaction_tool":
                    tool_output_content = await edit_interaction_tool.ainvoke(tool_args)
                elif tool_name == "retrieve_hcp_info_tool":
                    tool_output_content = await retrieve_hcp_info_tool.ainvoke(tool_args)
                else:
                    tool_output_content = f"Unknown tool: {tool_name}"
            except Exception as e:
                tool_output_content = f"Error executing tool {tool_name}: {e}"
            
            tool_outputs.append(ToolMessage(content=tool_output_content, tool_call_id=tool_call["id"]))
        
        state.messages.extend(tool_outputs)
    return {"messages": state.messages}

# Define the graph
workflow = StateGraph(AgentState)

# Add nodes to the graph
workflow.add_node("llm", call_llm_node)
workflow.add_node("tools", call_tool_node)

# Set the entry point
workflow.set_entry_point("llm")

# Define conditional edges
def should_continue(state: AgentState) -> str:
    """
    Determines whether the agent should continue by calling a tool or end the conversation.
    """
    print(f"--- LANGGRAPH DECISION: should_continue ---")
    last_message = state.messages[-1]
    # If the LLM invoked a tool, then we call the tool node
    if isinstance(last_message, AIMessage) and last_message.tool_calls:
        print(f"LLM wants to call a tool.")
        return "continue"
    # Otherwise, the LLM is done and wants to respond directly
    print(f"LLM wants to respond directly.")
    return "end"

def should_continue_after_tool(state: AgentState) -> str:
    """
    Determines whether the agent should loop back to the LLM after a tool call
    (e.g., if a clarifying question was asked) or end.
    """
    print(f"--- LANGGRAPH DECISION: should_continue_after_tool ---")
    last_tool_message = state.messages[-1]
    if isinstance(last_tool_message, ToolMessage):
        # A simple heuristic: if the tool output resembles a question, loop back
        # In a real system, the tool itself might return a flag.
        content = last_tool_message.content
        if isinstance(content, str) and ("question" in content.lower() or "clarify" in content.lower()):
            print("Tool output indicates a clarifying question, looping back to LLM.")
            return "loop_to_llm"
        elif isinstance(content, str) and "**HCP:**" in content and "**Date:**" in content:
            # If the tool generated a structured draft, we consider it a final step for the AI's turn
            # The frontend will handle confirmation.
            print("Tool output is a draft, ending LangGraph flow.")
            return "end"
    print("Tool output processed, ending LangGraph flow.")
    return "end" # Default to ending

workflow.add_conditional_edges(
    "llm", # From the LLM node
    should_continue, # Based on this function's return value
    {
        "continue": "tools", # If "continue", go to the tools node
        "end": END # If "end", terminate the graph
    }
)

workflow.add_conditional_edges(
    "tools",
    should_continue_after_tool,
    {
        "loop_to_llm": "llm", # If clarifying question, loop back to LLM to process next user input
        "end": END           # Otherwise, end the current agent turn
    }
)

# Compile the graph
app_graph = workflow.compile()

# --- API Endpoints ---

@app.post("/api/log_interaction/form", response_model=LogConfirmation, status_code=status.HTTP_201_CREATED)
async def log_interaction_form(
    interaction_data: HCPInteractionForm, # This is the Pydantic model
    db: Session = Depends(get_db) # Inject database session
):
    """
    Endpoint to log HCP interactions submitted via the structured form.
    Validates input data against the HCPInteractionForm Pydantic model and saves to MySQL.
    Expects dates as YYYY-MM-DD and times as HH:MM.
    """
    print(f"Received form data for database insertion: {interaction_data.model_dump_json(indent=2)}")
    
    # Pydantic handles most validation. Add specific business logic checks if needed.
    if not interaction_data.hcpName and not interaction_data.topicsDiscussed:
        raise HTTPException(status_code=400, detail="Either HCP Name or Topics Discussed must be provided.")
    
    try:
        # Pydantic has already converted date/time strings to datetime.date/time objects
        new_log = InteractionLogDB(
            hcpName=interaction_data.hcpName,
            interactionDate=interaction_data.interactionDate,
            interactionTime=interaction_data.interactionTime,
            interactionType=interaction_data.interactionType,
            attendees=json.dumps(interaction_data.attendees), # Store lists as JSON strings
            topicsDiscussed=interaction_data.topicsDiscussed,
            materialsShared=json.dumps(interaction_data.materialsShared), # Store lists as JSON strings
            samplesDistributed=json.dumps(interaction_data.samplesDistributed), # Store lists as JSON strings
            hcpSentiment=interaction_data.hcpSentiment,
            outcomes=interaction_data.outcomes,
            followUpActions=interaction_data.followUpActions,
            # timestamp will be set by default in the model
        )
        
        db.add(new_log)
        db.commit()      # Commit the transaction to save to DB
        db.refresh(new_log) # Refresh to get the auto-generated 'id' from the database

        print(f"Interaction {new_log.id} logged successfully to MySQL via form endpoint.")
        return LogConfirmation(
            message=f"Interaction with {interaction_data.hcpName} on {interaction_data.interactionDate.strftime('%Y-%m-%d')} logged successfully via form.",
            log_id=getattr(new_log, "id")
        )
    except Exception as e:
        db.rollback() # Rollback changes if an error occurs
        print(f"Error logging form interaction to MySQL: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to log interaction: {e}")

@app.post("/api/log_interaction/chat", response_model=ChatResponse)
async def log_interaction_chat(session_data: ChatSession = Body(...)):
    """
    Endpoint to handle conversational chat interactions with the AI agent (LangGraph).
    Sends user messages and chat history to the LangGraph agent and returns AI's response.
    """
    user_message_text = session_data.message
    chat_history_from_frontend = session_data.history
    
    print(f"Received chat message for LangGraph: {user_message_text}")
    if not user_message_text.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    # Convert frontend ChatMessage objects to LangChain BaseMessage objects
    langchain_messages: List[BaseMessage] = []
    
    # Add a system message at the beginning of the conversation for context
    langchain_messages.append(SystemMessage(content=(
        "You are a helpful AI assistant for logging interactions with Healthcare Professionals (HCPs). "
        "Your primary goal is to extract key details from the user's conversation (HCP name, date, time, attendees, "
        "topics discussed, materials/samples, sentiment, outcomes, follow-up actions). "
        "Once you have sufficient information for a complete log, offer to draft a summary in a structured format by calling the `log_interaction_tool`. "
        "If you don't have enough information, ask clarifying questions using `ask_clarifying_question_tool`. "
        "When drafting a log, ensure all parameters for `log_interaction_tool` are provided. "
        "Always respond concisely and directly address the user's query. "
        "**IMPORTANT: When extracting dates for `log_interaction_tool`, always use the DD-MM-YYYY format.** " # Stronger emphasis for LLM
        "**IMPORTANT: When extracting times for `log_interaction_tool`, always use the HH:MM format.**"
    )))

    for msg in chat_history_from_frontend:
        if msg.sender == "user":
            langchain_messages.append(HumanMessage(content=msg.text))
        elif msg.sender == "ai":
            # For AI messages, if they were 'draft' type, send their text content as AIMessage
            # The LLM will understand this as its previous output
            langchain_messages.append(AIMessage(content=msg.text))
    
    # Add the current user message to the history for the agent
    langchain_messages.append(HumanMessage(content=user_message_text))

    try:
        # Invoke the LangGraph agent with the current state
        final_state = await app_graph.ainvoke({"messages": langchain_messages})
        
        # Extract the last message from the final state, which should be the agent's response
        agent_response_message = final_state["messages"][-1]

        reply_text = ""
        response_type = "text"

        if isinstance(agent_response_message, AIMessage):
            if agent_response_message.tool_calls:
                # This path is usually hit when the LLM decided to call a tool, but LangGraph
                # has not yet executed it and returned the ToolMessage.
                # Since our `should_continue` redirects tool calls to `tools` node,
                # and `tools` node then typically ends or loops, we usually receive a ToolMessage here
                # if the tool was actually executed within the same chain.
                # However, if the LLM *decides* to call a tool and the graph is configured to end
                # at that decision point, then this block might be hit.
                # For our current graph, `call_tool_node` executes the tool and then the graph ends
                # (or loops back to llm). So, `agent_response_message` here is more likely
                # to be the `ToolMessage` if a tool was executed.
                # Let's handle it as a fallback or if the graph flow changes.
                tool_call = agent_response_message.tool_calls[0] # Assuming one tool call for simplicity
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]

                if tool_name == "log_interaction_tool":
                    response_type = "draft"
                    # We can execute the tool here to get the draft text, or expect it to be a ToolMessage later
                    reply_text = await log_interaction_tool.ainvoke(tool_args)
                else:
                    reply_text = f"AI decided to call tool: {tool_name} with args: {tool_args}. Awaiting tool execution output."
            else:
                # If the AI responded directly with text
                reply_text = agent_response_message.content
                # Heuristic to detect if the direct text response is a structured draft
                if "**HCP:**" in reply_text and "**Date:**" in reply_text and "**Topics:**" in reply_text:
                    response_type = "draft"
        
        elif isinstance(agent_response_message, ToolMessage):
            # This is the expected path when a tool has been successfully executed
            reply_text = agent_response_message.content
            # If the tool output is a structured draft (from log_interaction_tool), indicate it as such
            if "**HCP:**" in reply_text and "**Date:**" in reply_text and "**Topics:**" in reply_text:
                response_type = "draft"
            # If it's a clarifying question from ask_clarifying_question_tool
            elif isinstance(reply_text, str) and ("question" in reply_text.lower() or "clarify" in reply_text.lower()):
                response_type = "text" # Still text, but might prompt frontend for specific action

        elif isinstance(agent_response_message, HumanMessage):
            # This case should ideally not happen if the agent is working correctly,
            # but as a fallback, we'll return the human message content.
            reply_text = agent_response_message.content
        else:
            reply_text = "Sorry, I couldn't process that request."

        return ChatResponse(reply=str(reply_text), type=response_type, id=str(uuid.uuid4()))

    except Exception as e:
        print(f"Error invoking LangGraph agent: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error processing chat: {str(e)}")


@app.post("/api/log_interaction/chat_confirm", response_model=LogConfirmation, status_code=status.HTTP_201_CREATED)
async def confirm_chat_interaction_log(
    draft_data: Dict[str, Any], # Keep as Dict[str, Any] initially to handle raw input
    db: Session = Depends(get_db)
):
    """
    Endpoint to confirm and log an HCP interaction initiated via chat and approved by the user.
    Performs specific parsing for DD-MM-YYYY dates and HH:MM times from the draft
    before validating against the HCPInteractionForm Pydantic model and saving to MySQL.
    """
    print(f"Received raw draft_data in chat_confirm: {json.dumps(draft_data, indent=2)}")

    # Normalize hcpSentiment: remove 'N/A' or empty strings to None
    hcp_sentiment = draft_data.get("hcpSentiment", "").strip()
    if hcp_sentiment == 'N/A' or hcp_sentiment == '':
        hcp_sentiment = None
    # Ensure sentiment is one of the allowed literals or None
    if hcp_sentiment not in ['Positive', 'Neutral', 'Negative', None]:
         raise HTTPException(status_code=400, detail=f"Invalid HCP Sentiment: '{hcp_sentiment}'. Must be Positive, Neutral, Negative, or empty/N/A.")

    # --- Pre-parsing of date and time strings from DD-MM-YYYY / HH:MM to datetime objects ---
    interaction_date_obj = None
    date_str = draft_data.get("interactionDate")
    if date_str:
        try:
            # Date from AI draft is DD-MM-YYYY, so parse it with that format
            interaction_date_obj = datetime.datetime.strptime(date_str.strip(), "%d-%m-%Y").date()
        except ValueError:
            print(f"DEBUG BACKEND ERROR: ValueError parsing date '{date_str.strip()}' with format '%d-%m-%Y'")
            raise HTTPException(status_code=400, detail=f"Invalid date format for 'interactionDate': '{date_str}'. Expected DD-MM-YYYY.")

    interaction_time_obj = None
    time_str = draft_data.get("interactionTime")
    if time_str:
        try:
            # Time from AI draft is HH:MM, so parse it with that format
            interaction_time_obj = datetime.datetime.strptime(time_str.strip(), "%H:%M").time()
        except ValueError:
            print(f"DEBUG BACKEND ERROR: ValueError parsing time '{time_str}' with format '%H:%M'")
            raise HTTPException(status_code=400, detail=f"Invalid time format for 'interactionTime': '{time_str}'. Expected HH:MM.")

    try:
        # Create a dictionary with parsed data to pass to Pydantic model
        # Pydantic will then validate these parsed Python objects
        parsed_data_for_pydantic = {
            "hcpName": draft_data.get("hcpName") or "",
            "interactionDate": interaction_date_obj, # Pass the parsed date object
            "interactionTime": interaction_time_obj, # Pass the parsed time object
            "interactionType": draft_data.get("interactionType", "Meeting"),
            "attendees": draft_data.get("attendees", []),
            "topicsDiscussed": draft_data.get("topicsDiscussed") or "",
            "materialsShared": draft_data.get("materialsShared", []),
            "samplesDistributed": draft_data.get("samplesDistributed", []),
            "hcpSentiment": hcp_sentiment, # Use the normalized sentiment
            "outcomes": draft_data.get("outcomes") or "",
            "followUpActions": draft_data.get("followUpActions") or ""
        }
        
        # Validate the processed data against the HCPInteractionForm model
        # This will catch missing required fields or incorrect types after our manual parsing
        parsed_data = HCPInteractionForm(**parsed_data_for_pydantic)

    except ValidationError as e:
        print(f"Validation error for chat_confirm data (Pydantic model): {e.errors()}")
        # FastAPI's HTTPException will automatically format Pydantic validation errors nicely
        raise HTTPException(status_code=400, detail=f"Invalid data for chat confirmation: {e.errors()}")
    except Exception as e:
        # Catch other potential errors during pre-processing (e.g., unexpected data types from draft_data)
        print(f"Error during pre-processing for chat_confirm: {e}")
        raise HTTPException(status_code=400, detail=f"Error processing chat confirmation data: {e}")

    try:
        db_log = InteractionLogDB(
            hcpName=parsed_data.hcpName,
            interactionDate=parsed_data.interactionDate,
            interactionTime=parsed_data.interactionTime,
            interactionType=parsed_data.interactionType,
            attendees=json.dumps(parsed_data.attendees), # Store lists as JSON strings
            topicsDiscussed=parsed_data.topicsDiscussed,
            materialsShared=json.dumps(parsed_data.materialsShared), # Store lists as JSON strings
            samplesDistributed=json.dumps(parsed_data.samplesDistributed), # Store lists as JSON strings
            hcpSentiment=parsed_data.hcpSentiment,
            outcomes=parsed_data.outcomes,
            followUpActions=parsed_data.followUpActions
        )
        db.add(db_log)
        db.commit()
        db.refresh(db_log)
        
        print(f"DEBUG BACKEND: Log successfully added to DB with ID: {db_log.id}")

        return LogConfirmation(message="Log confirmed and saved successfully!", log_id=getattr(db_log, "id"))

    except Exception as e:
        db.rollback() # Rollback in case of an error during DB operations
        print(f"DEBUG BACKEND ERROR: Database transaction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save log to database: {e}")

@app.get("/api/logs", response_model=List[HCPLogResponse])
async def get_all_logs(db: Session = Depends(get_db)):
    """
    Fetches all interaction logs from the database.
    Formats dates to DD-MM-YYYY strings and times to HH:MM strings for the response.
    """
    print("Fetching all interaction logs from the database...")
    logs = db.query(InteractionLogDB).all()
    
    # Manually convert SQLAlchemy objects to Pydantic response models
    response_logs = []
    for log in logs:
        try:
            formatted_date = log.interactionDate.strftime("%d-%m-%Y") if log.interactionDate is not None else None
            # Convert time to HH:MM string
            formatted_time = log.interactionTime.strftime("%H:%M") if log.interactionTime is not None else None
            # Convert timestamp to ISO string
            formatted_timestamp = log.timestamp.isoformat() if log.timestamp is not None else None

            attendees_list = json.loads(getattr(log, "attendees")) if getattr(log, "attendees", None) is not None else []
            materials_shared_list = json.loads(getattr(log, "materialsShared")) if getattr(log, "materialsShared", None) is not None else []
            samples_distributed_list = json.loads(getattr(log, "samplesDistributed")) if getattr(log, "samplesDistributed", None) is not None else []

            response_logs.append(HCPLogResponse(
                id=getattr(log, "id"),
                hcpName=getattr(log, "hcpName"),
                interactionDate=formatted_date or "",
                interactionTime=formatted_time,
                interactionType=getattr(log, "interactionType"),
                attendees=attendees_list,
                topicsDiscussed=getattr(log, "topicsDiscussed"),
                materialsShared=materials_shared_list,
                samplesDistributed=samples_distributed_list,
                hcpSentiment=getattr(log, "hcpSentiment", None),
                outcomes=getattr(log, "outcomes", None),
                followUpActions=getattr(log, "followUpActions", None),
                timestamp=formatted_timestamp or ""
            ))
        except Exception as e:
            print(f"Error processing log ID {log.id if hasattr(log, 'id') else 'N/A'} for response: {e}")
            # Log the error and continue to process other logs
            continue
            
    print(f"Fetched {len(response_logs)} logs.")
    return response_logs

@app.get("/")
async def root():
    """Root endpoint for a simple health check."""
    return {"message": "HCP Interaction Logger API (with Gemma-2-9B-IT on Groq, storing in MySQL) is running!"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")